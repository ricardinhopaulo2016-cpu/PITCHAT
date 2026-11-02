import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { accountBelongsToProfile, loadAutomationForWorkspace } from "@/lib/automation/repo";
import type { Graph } from "@/lib/automation/graph";
import { invalidGraphBody, validateGraph } from "@/lib/automation/validate-graph";

export const runtime = "nodejs";

/**
 * Duplica a automação: clona nome ("Cópia de X") e o grafo mais recente
 * (publicado ou draft) como draft v1 de uma automação nova. `socialAccountId`
 * no body aponta a cópia para outra conta; sem ele, mantém a conta da origem.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const source = await loadAutomationForWorkspace(admin, id, auth.workspace.id);
  if (!source) return NextResponse.json({ error: "AUTOMATION_NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const targetAccountId = typeof body?.socialAccountId === "string" && body.socialAccountId ? body.socialAccountId : null;
  if (targetAccountId && !(await accountBelongsToProfile(admin, auth.workspace.id, source.profile_id, targetAccountId))) {
    return NextResponse.json({ error: "SOCIAL_ACCOUNT_NOT_FOUND" }, { status: 404 });
  }

  const { data: lastVersion } = await admin
    .from("automation_versions")
    .select("graph")
    .eq("automation_id", id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const graph = (lastVersion?.graph as Graph | undefined) ?? { nodes: [], edges: [] };
  // A cópia é rascunho (completude só avisa), mas um grafo estruturalmente quebrado não é clonado.
  const validation = validateGraph(graph, { stage: "draft" });
  if (!validation.ok) return NextResponse.json(invalidGraphBody(validation), { status: 422 });

  const { data: created, error: createError } = await admin
    .from("automations")
    .insert({
      workspace_id: auth.workspace.id,
      profile_id: source.profile_id,
      social_account_id: targetAccountId ?? source.social_account_id,
      name: `Cópia de ${source.name}`,
      description: source.description,
      status: "draft",
    })
    .select("id")
    .single();

  if (createError || !created) {
    return NextResponse.json({ error: "DB_ERROR", detail: createError?.message }, { status: 500 });
  }

  const { error: versionError } = await admin
    .from("automation_versions")
    .insert({ automation_id: created.id, version: 1, status: "draft", graph: graph as never });

  if (versionError) return NextResponse.json({ error: "DB_ERROR", detail: versionError.message }, { status: 500 });

  return NextResponse.json({ ok: true, id: created.id });
}
