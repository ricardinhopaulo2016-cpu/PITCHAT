import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { resubscribeWorkspaceWebhooks } from "@/lib/meta/resubscribe";

export const runtime = "nodejs";

/** Reassina os webhooks das contas do workspace da sessão, com resultado por conta. */
export async function POST() {
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  try {
    const results = await resubscribeWorkspaceWebhooks(admin, auth.workspace.id);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ error: "RESUBSCRIBE_FAILED" }, { status: 500 });
  }
}
