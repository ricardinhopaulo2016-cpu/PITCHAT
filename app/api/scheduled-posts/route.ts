import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { schedulePostAdvance } from "@/lib/qstash";
import { MAX_QUEUE_DELAY_SECONDS, startKey } from "@/lib/publishing/engine";
import {
  CAPTION_MAX_LENGTH,
  COLLISION_WINDOW_MS,
  accountCanPublish,
  collides,
  validateAssetForPublishing,
  type PublishableAsset,
} from "@/lib/publishing/validate";

export const runtime = "nodejs";

const MAX_SCHEDULE_AHEAD_MS = 90 * 24 * 60 * 60_000;

const bodySchema = z.object({
  mediaAssetId: z.string().uuid(),
  mediaType: z.enum(["REELS", "STORIES"]),
  shareToFeed: z.boolean().default(true),
  items: z
    .array(
      z.object({
        socialAccountId: z.string().uuid(),
        caption: z.string().max(CAPTION_MAX_LENGTH).default(""),
        // null = publicar agora.
        scheduledAt: z.string().datetime({ offset: true }).nullable(),
      })
    )
    .min(1)
    .max(50),
});

/**
 * Cria um lote: uma mídia em uma ou mais contas. Tudo ou nada: qualquer
 * problema em qualquer item recusa o lote inteiro, sem deixar post pela metade.
 * Confirmar aqui é a aprovação; depois disso o lote publica sozinho.
 */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY", problems: [parsed.error.issues[0]?.message ?? "Dados inválidos."] }, { status: 400 });
  }
  const { mediaAssetId, mediaType, shareToFeed, items } = parsed.data;
  const now = new Date();

  const { data: asset } = await admin
    .from("media_assets")
    .select("id, status, storage_removed_at, mime_type, file_size, duration_ms, width, height, fps, codec")
    .eq("id", mediaAssetId)
    .eq("workspace_id", auth.workspace.id)
    .maybeSingle<PublishableAsset & { id: string; status: string; storage_removed_at: string | null }>();
  if (!asset || asset.status !== "ready") {
    return NextResponse.json({ error: "MEDIA_NOT_READY", problems: ["Essa mídia não está pronta."] }, { status: 422 });
  }
  if (asset.storage_removed_at) {
    return NextResponse.json(
      { error: "MEDIA_FILE_REMOVED", problems: ["O arquivo desse vídeo foi apagado depois de publicar. Envie o vídeo de novo para postar."] },
      { status: 422 }
    );
  }

  const problems = [...validateAssetForPublishing(asset, mediaType).errors];

  const accountIds = [...new Set(items.map((i) => i.socialAccountId))];
  if (accountIds.length !== items.length) problems.push("A mesma conta apareceu duas vezes no lote.");

  const { data: accounts } = await admin
    .from("social_accounts")
    .select("id, username, status, permissions")
    .eq("workspace_id", auth.workspace.id)
    .in("id", accountIds);
  const accountById = new Map((accounts ?? []).map((a) => [a.id as string, a]));

  const { data: existing } = await admin
    .from("scheduled_posts")
    .select("social_account_id, media_asset_id, media_type, scheduled_at, status")
    .eq("workspace_id", auth.workspace.id)
    .in("social_account_id", accountIds)
    .in("status", ["scheduled", "processing", "published"]);

  const rows = items.map((item) => {
    const account = accountById.get(item.socialAccountId);
    const name = account?.username ? `@${account.username}` : "Conta";
    const when = item.scheduledAt ? new Date(item.scheduledAt) : now;

    if (!account) problems.push("Conta não encontrada.");
    else if (!accountCanPublish(account)) problems.push(`${name} precisa ser reconectada para publicar.`);

    if (when.getTime() < now.getTime() - 60_000) problems.push(`${name}: o horário já passou.`);
    if (when.getTime() > now.getTime() + MAX_SCHEDULE_AHEAD_MS) problems.push(`${name}: agende com até 90 dias de antecedência.`);

    for (const other of existing ?? []) {
      if (other.social_account_id !== item.socialAccountId || other.media_type !== mediaType) continue;
      if (mediaType === "REELS" && other.media_asset_id === mediaAssetId) {
        problems.push(`${name} já tem esse vídeo como Reel.`);
      } else if (other.status !== "published" && collides(when, new Date(other.scheduled_at))) {
        problems.push(`${name} já tem um post a menos de ${COLLISION_WINDOW_MS / 60_000} minutos desse horário.`);
      }
    }

    return {
      workspace_id: auth.workspace.id,
      social_account_id: item.socialAccountId,
      media_asset_id: mediaAssetId,
      media_type: mediaType,
      // Stories não aceitam legenda pela API.
      caption: mediaType === "REELS" ? item.caption.trim() || null : null,
      share_to_feed: shareToFeed,
      scheduled_at: when.toISOString(),
      created_by: auth.userId,
    };
  });

  if (problems.length > 0) {
    return NextResponse.json({ error: "VALIDATION_FAILED", problems: [...new Set(problems)] }, { status: 422 });
  }

  const batchId = randomUUID();
  const { data: created, error: insertError } = await admin
    .from("scheduled_posts")
    .insert(rows.map((r) => ({ ...r, batch_id: batchId })))
    .select("id, scheduled_at");
  if (insertError || !created) {
    return NextResponse.json({ error: "DB_INSERT_FAILED", problems: ["Não foi possível salvar o lote."] }, { status: 500 });
  }

  // Post além do atraso máximo do QStash fica para o varredor diário.
  const queued = await Promise.all(
    created.map(async (post) => {
      const delaySeconds = Math.max(0, Math.ceil((new Date(post.scheduled_at).getTime() - Date.now()) / 1000));
      if (delaySeconds > MAX_QUEUE_DELAY_SECONDS) return { id: post.id, ok: true };
      const result = await schedulePostAdvance({ postId: post.id, delaySeconds, deduplicationId: startKey(post) });
      return { id: post.id, ok: result.ok };
    })
  );

  const failedIds = queued.filter((q) => !q.ok).map((q) => q.id);
  if (failedIds.length > 0) {
    await admin
      .from("scheduled_posts")
      .update({ status: "failed", last_error: { reason: "QUEUE_FAILED" }, updated_at: new Date().toISOString() })
      .in("id", failedIds);
  }

  return NextResponse.json({ batchId, created: created.length, queueFailures: failedIds.length }, { status: 201 });
}
