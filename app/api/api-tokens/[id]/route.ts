import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/** Revoga o token. Fica na lista como revogado; nunca volta a valer. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const { id } = await params;
  const { data, error } = await admin
    .from("api_tokens")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("workspace_id", auth.workspace.id)
    .is("revoked_at", null)
    .select("id");
  if (error) return NextResponse.json({ error: "DB_UPDATE_FAILED" }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  return NextResponse.json({ revoked: true });
}
