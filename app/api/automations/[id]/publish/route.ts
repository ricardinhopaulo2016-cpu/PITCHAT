import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadAutomationForWorkspace, loadDraftVersion } from "@/lib/automation/repo";

export const runtime = "nodejs";

/**
 * Publica a versão draft atual: vira 'published' (imutável a partir daí — ver
 * docs/PITCHAT_ARCHITECTURE.md §9, quem já está executando uma versão antiga
 * termina nela) e vira `automations.current_version_id`. Não muda
 * `automations.status` — publicar não é o mesmo que ativar (botão separado).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const automation = await loadAutomationForWorkspace(admin, id, auth.workspace.id);
  if (!automation) return NextResponse.json({ error: "AUTOMATION_NOT_FOUND" }, { status: 404 });

  const draft = await loadDraftVersion(admin, id);
  if (!draft) return NextResponse.json({ error: "NO_DRAFT_TO_PUBLISH" }, { status: 400 });

  const now = new Date().toISOString();
  const { error: versionError } = await admin
    .from("automation_versions")
    .update({ status: "published", published_at: now })
    .eq("id", draft.id);
  if (versionError) return NextResponse.json({ error: "DB_ERROR", detail: versionError.message }, { status: 500 });

  const { error: automationError } = await admin
    .from("automations")
    .update({ current_version_id: draft.id, updated_at: now })
    .eq("id", id);
  if (automationError) {
    return NextResponse.json({ error: "DB_ERROR", detail: automationError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, publishedVersion: draft.version });
}
