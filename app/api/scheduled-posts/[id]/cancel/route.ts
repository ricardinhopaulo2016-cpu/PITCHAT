import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Só cancela o que ainda não começou. O job que já está na fila encontra o status e não faz nada. */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const { data, error } = await admin
    .from("scheduled_posts")
    .update({ status: "canceled", updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", auth.workspace.id)
    .eq("status", "scheduled")
    .select("id");
  if (error) return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "NOT_CANCELABLE" }, { status: 409 });

  return NextResponse.json({ ok: true });
}
