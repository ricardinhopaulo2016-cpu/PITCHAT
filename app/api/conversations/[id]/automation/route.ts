import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadConversationForWorkspace } from "@/lib/inbox/repo";

export const runtime = "nodejs";

/**
 * Human takeover — liga/desliga `conversations.automation_enabled`. Esse
 * campo agora é um portão de verdade (ver lib/automation/ingest.ts e
 * app/api/jobs/resume-automation-run/route.ts, achado real 24/09/2026: antes
 * só valia dentro de um CONDITION opcional na automação). Registra em
 * `audit_logs` — tabela existia desde o início do schema, nunca usada até
 * agora.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const enabled = body?.enabled;
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "INVALID_BODY", detail: "esperado { enabled: boolean }" }, { status: 400 });
  }

  const conversation = await loadConversationForWorkspace(admin, id, auth.workspace.id);
  if (!conversation) return NextResponse.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });

  if (conversation.automation_enabled === enabled) {
    return NextResponse.json({ ok: true, automationEnabled: enabled, unchanged: true });
  }

  const { error } = await admin
    .from("conversations")
    .update({ automation_enabled: enabled, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) return NextResponse.json({ error: "DB_ERROR", detail: error.message }, { status: 500 });

  await admin.from("audit_logs").insert({
    workspace_id: auth.workspace.id,
    actor_user_id: auth.userId,
    action: enabled ? "conversation.automation_reactivated" : "conversation.human_takeover",
    entity_type: "conversation",
    entity_id: id,
    before: { automation_enabled: conversation.automation_enabled },
    after: { automation_enabled: enabled },
  });

  return NextResponse.json({ ok: true, automationEnabled: enabled });
}
