import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildExampleFlow, compileFlowToGraph } from "@/lib/automation/flow-spec";

export const runtime = "nodejs";

/**
 * Cria o flow de referência do MVP (seção 11 do briefing) — "Instagram
 * Comment → DM Test" — pro profileId informado. Nunca hardcoded pra um
 * profile específico (AGENTS.md: nome de perfil sempre em `profiles.name`).
 * Fica pronto em modo draft (versão já publicada, automação ainda não
 * ativada) — ativar é uma ação explícita separada, nunca automática.
 */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const profileId = typeof body?.profileId === "string" ? body.profileId : null;
  if (!profileId) return NextResponse.json({ error: "profileId é obrigatório" }, { status: 400 });

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", profileId)
    .eq("workspace_id", auth.workspace.id)
    .maybeSingle();
  if (!profile) return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });

  const { data: automation, error: automationError } = await admin
    .from("automations")
    .insert({
      workspace_id: auth.workspace.id,
      profile_id: profileId,
      name: "Instagram Comment → DM Test",
      description: "Flow de referência do MVP: comentário → keyword → public reply → private reply → quick reply → link → delay → follow-up.",
      status: "draft",
    })
    .select("id")
    .single();

  if (automationError || !automation) {
    return NextResponse.json({ error: "DB_ERROR", detail: automationError?.message }, { status: 500 });
  }

  const now = new Date().toISOString();
  const { data: version, error: versionError } = await admin
    .from("automation_versions")
    .insert({
      automation_id: automation.id,
      version: 1,
      status: "published",
      graph: compileFlowToGraph(buildExampleFlow()) as never,
      published_at: now,
    })
    .select("id")
    .single();

  if (versionError || !version) {
    return NextResponse.json({ error: "DB_ERROR", detail: versionError?.message }, { status: 500 });
  }

  const { error: updateError } = await admin
    .from("automations")
    .update({ current_version_id: version.id })
    .eq("id", automation.id);

  if (updateError) return NextResponse.json({ error: "DB_ERROR", detail: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: automation.id });
}
