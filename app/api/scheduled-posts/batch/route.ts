import { NextResponse } from "next/server";
import { z } from "zod";
import { getRequestAuth } from "@/lib/auth/api-token";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { CAPTION_MAX_LENGTH } from "@/lib/publishing/validate";
import { MAX_BATCH_ITEMS } from "@/lib/publishing/batch";
import { createPlannedPosts, planBatchFromDb } from "@/lib/publishing/create-batch";

export const runtime = "nodejs";

const bodySchema = z.object({
  /** true = só confere e devolve o plano, sem gravar nada. É a revisão. */
  dryRun: z.boolean().default(false),
  posts: z
    .array(
      z.object({
        clientRef: z.string().trim().min(1).max(120).nullable().default(null),
        mediaAssetId: z.string().uuid(),
        /** id da conta ou @username. */
        account: z.string().trim().min(1).max(100),
        mediaType: z.enum(["REELS", "STORIES"]).default("REELS"),
        caption: z.string().max(CAPTION_MAX_LENGTH).default(""),
        scheduledAt: z.string().datetime({ offset: true }).nullable(),
        shareToFeed: z.boolean().default(true),
      })
    )
    .min(1)
    .max(MAX_BATCH_ITEMS),
});

/**
 * Lote de vários vídeos, cada um com conta, legenda e horário. Usado pela API
 * (token) e pela tela de lote (sessão). Tudo ou nada; `clientRef` repetido não
 * cria outro post, devolve o que já existe.
 */
export async function POST(request: Request) {
  const auth = await getRequestAuth(request);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const where = issue?.path.length ? `${issue.path.join(".")}: ` : "";
    return NextResponse.json({ error: "INVALID_BODY", problems: [where + (issue?.message ?? "Dados inválidos.")] }, { status: 400 });
  }
  const { dryRun, posts } = parsed.data;

  const plan = await planBatchFromDb(admin, auth.workspace.id, posts);
  const items = plan.items.map(({ row, ...item }) => ({ ...item, willCreate: !!row }));

  if (!plan.ok) return NextResponse.json({ error: "VALIDATION_FAILED", items }, { status: 422 });
  if (dryRun) return NextResponse.json({ dryRun: true, toCreate: plan.toCreate.length, items });

  const result = await createPlannedPosts(admin, auth.workspace.id, auth.userId, plan);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "DUPLICATE_CLIENT_REF" ? 409 : 500 });
  }
  return NextResponse.json({ batchId: result.batchId, created: result.created, queueFailures: result.queueFailures, items }, { status: 201 });
}

/** Situação dos posts por lote ou por código: ?batchId=... ou ?clientRef=A&clientRef=B. */
export async function GET(request: Request) {
  const auth = await getRequestAuth(request);
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const url = new URL(request.url);
  const batchId = url.searchParams.get("batchId");
  const refs = url.searchParams.getAll("clientRef").filter((r) => r.length > 0 && r.length <= 120);
  if (batchId && !z.string().uuid().safeParse(batchId).success) {
    return NextResponse.json({ error: "INVALID_QUERY", problems: ["batchId inválido."] }, { status: 400 });
  }
  if (!batchId && refs.length === 0) {
    return NextResponse.json({ error: "INVALID_QUERY", problems: ["Informe batchId ou clientRef."] }, { status: 400 });
  }

  let query = admin
    .from("scheduled_posts")
    .select("id, client_ref, batch_id, social_account_id, media_asset_id, media_type, scheduled_at, status, permalink, published_at, last_error")
    .eq("workspace_id", auth.workspace.id)
    .order("scheduled_at", { ascending: true })
    .limit(MAX_BATCH_ITEMS);
  if (batchId) query = query.eq("batch_id", batchId);
  if (refs.length) query = query.in("client_ref", refs.slice(0, MAX_BATCH_ITEMS));

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "DB_READ_FAILED" }, { status: 500 });
  return NextResponse.json({ posts: data ?? [] });
}
