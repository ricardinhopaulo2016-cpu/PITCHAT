import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { countUnreadConversations } from "@/lib/inbox/repo";

export const runtime = "nodejs";

/** Total de conversas não lidas do workspace da sessão, para o badge do menu. */
export async function GET() {
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const count = await countUnreadConversations(admin, auth.workspace.id);
  return NextResponse.json({ count });
}
