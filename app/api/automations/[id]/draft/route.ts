import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { compileFlowToGraph, EMPTY_FLOW, validateFlowSpec } from "@/lib/automation/flow-spec";
import { ensureDraftVersion, loadAutomationForWorkspace } from "@/lib/automation/repo";

export const runtime = "nodejs";

/** Salva o flow spec do editor sequencial na versão draft (cria uma se não houver). */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const automation = await loadAutomationForWorkspace(admin, id, auth.workspace.id);
  if (!automation) return NextResponse.json({ error: "AUTOMATION_NOT_FOUND" }, { status: 404 });

  const body = await request.json().catch(() => null);
  const result = validateFlowSpec(body);
  if (!result.ok) return NextResponse.json({ error: "INVALID_FLOW", detail: result.error }, { status: 400 });

  const graph = compileFlowToGraph(result.spec);
  const draft = await ensureDraftVersion(admin, id, compileFlowToGraph(EMPTY_FLOW));

  const { error } = await admin
    .from("automation_versions")
    .update({ graph: graph as never })
    .eq("id", draft.id);

  if (error) return NextResponse.json({ error: "DB_ERROR", detail: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, versionId: draft.id, version: draft.version });
}
