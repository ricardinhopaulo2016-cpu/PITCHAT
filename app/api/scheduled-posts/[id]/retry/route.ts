import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { schedulePostAdvance } from "@/lib/qstash";
import { retryPatch, startKey } from "@/lib/publishing/engine";

export const runtime = "nodejs";

/** Tenta de novo um post com erro, publicando agora. Ver retryPatch: nunca duplica. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const { data: post } = await admin
    .from("scheduled_posts")
    .select("id, status, publish_attempted_at")
    .eq("id", id)
    .eq("workspace_id", auth.workspace.id)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  const patch = retryPatch(post, new Date());
  const { data: updated, error } = await admin
    .from("scheduled_posts")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "failed")
    .select("id");
  if (error) return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });
  if (!updated?.length) return NextResponse.json({ error: "NOT_RETRYABLE" }, { status: 409 });

  const queued = await schedulePostAdvance({ postId: id, delaySeconds: 0, deduplicationId: startKey({ id, scheduled_at: patch.scheduled_at }) });
  if (!queued.ok) {
    await admin
      .from("scheduled_posts")
      .update({ status: "failed", last_error: { reason: "QUEUE_FAILED" }, updated_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ error: "QUEUE_FAILED" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
