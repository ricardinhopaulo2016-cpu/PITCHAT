import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { schedulePostAdvance } from "@/lib/qstash";
import { planBatch, type BatchAccount, type BatchAsset, type BatchItemInput, type BatchPlan, type ExistingPost, type ExistingRef } from "./batch";
import { MAX_QUEUE_DELAY_SECONDS, startKey } from "./engine";

const ASSET_COLUMNS = "id, status, storage_removed_at, original_filename, mime_type, file_size, duration_ms, width, height, fps, codec";

/** Carrega do banco tudo o que planBatch precisa, sempre preso ao workspace de quem chamou. */
export async function planBatchFromDb(admin: SupabaseClient, workspaceId: string, items: BatchItemInput[], now = new Date()): Promise<BatchPlan> {
  const assetIds = [...new Set(items.map((i) => i.mediaAssetId))];
  const refs = [...new Set(items.map((i) => i.clientRef?.trim()).filter((r): r is string => !!r))];

  const [{ data: assets }, { data: accounts }, { data: existingRefs }] = await Promise.all([
    admin.from("media_assets").select(ASSET_COLUMNS).eq("workspace_id", workspaceId).in("id", assetIds),
    admin.from("social_accounts").select("id, username, status, permissions").eq("workspace_id", workspaceId).eq("platform", "instagram"),
    refs.length
      ? admin.from("scheduled_posts").select("id, client_ref, status, scheduled_at").eq("workspace_id", workspaceId).in("client_ref", refs)
      : Promise.resolve({ data: [] as ExistingRef[] }),
  ]);

  const accountIds = (accounts ?? []).map((a) => a.id as string);
  const { data: existingPosts } = accountIds.length
    ? await admin
        .from("scheduled_posts")
        .select("social_account_id, media_asset_id, media_type, scheduled_at, status")
        .eq("workspace_id", workspaceId)
        .in("social_account_id", accountIds)
        .in("status", ["scheduled", "processing", "published"])
    : { data: [] as ExistingPost[] };

  return planBatch({
    items,
    assets: (assets ?? []) as BatchAsset[],
    accounts: (accounts ?? []) as BatchAccount[],
    existingPosts: (existingPosts ?? []) as ExistingPost[],
    existingRefs: (existingRefs ?? []) as ExistingRef[],
    now,
  });
}

export type CreateResult =
  | { ok: true; batchId: string | null; created: { id: string; clientRef: string | null; scheduledAt: string }[]; queueFailures: number }
  | { ok: false; error: "DB_INSERT_FAILED" | "DUPLICATE_CLIENT_REF" };

/** Grava o plano aprovado e põe cada post na fila. Post além do atraso máximo do QStash fica para o varredor diário. */
export async function createPlannedPosts(admin: SupabaseClient, workspaceId: string, userId: string, plan: BatchPlan): Promise<CreateResult> {
  if (!plan.ok) throw new Error("createPlannedPosts chamado com plano inválido");
  if (plan.toCreate.length === 0) return { ok: true, batchId: null, created: [], queueFailures: 0 };

  const batchId = randomUUID();
  // Sem código, a coluna client_ref nem é citada: a tela antiga segue funcionando
  // mesmo antes da migration que cria a coluna.
  const withRefs = plan.toCreate.some((row) => row.client_ref);
  const rows = plan.toCreate.map(({ client_ref, ...row }) => ({
    ...row,
    ...(withRefs ? { client_ref } : {}),
    workspace_id: workspaceId,
    created_by: userId,
    batch_id: batchId,
  }));
  const { data: created, error } = await admin
    .from("scheduled_posts")
    .insert(rows)
    .select(withRefs ? "id, scheduled_at, client_ref" : "id, scheduled_at")
    .returns<{ id: string; scheduled_at: string; client_ref?: string | null }[]>();
  // 23505 = outro envio gravou o mesmo código no meio do caminho. O índice único barrou: nada duplicou.
  if (error?.code === "23505") return { ok: false, error: "DUPLICATE_CLIENT_REF" };
  if (error || !created) return { ok: false, error: "DB_INSERT_FAILED" };

  const queued = await Promise.all(
    created.map(async (post) => {
      const delaySeconds = Math.max(0, Math.ceil((new Date(post.scheduled_at).getTime() - Date.now()) / 1000));
      if (delaySeconds > MAX_QUEUE_DELAY_SECONDS) return { id: post.id as string, ok: true };
      const result = await schedulePostAdvance({ postId: post.id, delaySeconds, deduplicationId: startKey(post) });
      return { id: post.id as string, ok: result.ok };
    })
  );

  const failedIds = queued.filter((q) => !q.ok).map((q) => q.id);
  if (failedIds.length > 0) {
    await admin
      .from("scheduled_posts")
      .update({ status: "failed", last_error: { reason: "QUEUE_FAILED" }, updated_at: new Date().toISOString() })
      .in("id", failedIds);
  }

  return {
    ok: true,
    batchId,
    created: created.map((p) => ({ id: p.id as string, clientRef: (p.client_ref as string | null) ?? null, scheduledAt: p.scheduled_at as string })),
    queueFailures: failedIds.length,
  };
}
