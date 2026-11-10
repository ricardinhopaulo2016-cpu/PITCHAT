import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/auth/api-token";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { CAPTION_MAX_LENGTH } from "@/lib/publishing/validate";
import { createPlannedPosts, planBatchFromDb } from "@/lib/publishing/create-batch";

export const runtime = "nodejs";

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
 * Cria um lote: uma mídia em uma ou mais contas (tela Publicar). Tudo ou nada:
 * qualquer problema em qualquer item recusa o lote inteiro. Confirmar aqui é a
 * aprovação; depois disso o lote publica sozinho. Mesma regra de
 * /api/scheduled-posts/batch, que aceita vários vídeos.
 */
export async function POST(request: Request) {
  const auth = await getRequestAuth(request);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "INVALID_BODY", problems: [parsed.error.issues[0]?.message ?? "Dados inválidos."] }, { status: 400 });
  }
  const { mediaAssetId, mediaType, shareToFeed, items } = parsed.data;

  const problems: string[] = [];
  if (new Set(items.map((i) => i.socialAccountId)).size !== items.length) problems.push("A mesma conta apareceu duas vezes no lote.");

  const plan = await planBatchFromDb(
    admin,
    auth.workspace.id,
    items.map((i) => ({ clientRef: null, mediaAssetId, account: i.socialAccountId, mediaType, caption: i.caption, scheduledAt: i.scheduledAt, shareToFeed }))
  );
  problems.push(...plan.items.flatMap((i) => i.problems));
  if (problems.length > 0) {
    const notReady = plan.items.every((i) => i.problems.includes("Essa mídia não está pronta."));
    return NextResponse.json({ error: notReady ? "MEDIA_NOT_READY" : "VALIDATION_FAILED", problems: [...new Set(problems)] }, { status: 422 });
  }

  const result = await createPlannedPosts(admin, auth.workspace.id, auth.userId, plan);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, problems: ["Não foi possível salvar o lote."] }, { status: 500 });
  }
  return NextResponse.json({ batchId: result.batchId, created: result.created.length, queueFailures: result.queueFailures }, { status: 201 });
}
