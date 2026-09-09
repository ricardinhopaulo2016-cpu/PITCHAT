import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { compileFlowToGraph, EMPTY_FLOW } from "@/lib/automation/flow-spec";

export const runtime = "nodejs";

/** Cria uma automação nova: draft, sem versão publicada, com uma v1 draft vazia (trigger -> end). */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const profileId = typeof body?.profileId === "string" ? body.profileId : null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const description = typeof body?.description === "string" ? body.description : null;

  if (!profileId || !name) {
    return NextResponse.json({ error: "profileId e name são obrigatórios" }, { status: 400 });
  }

  // Nunca confia em profileId vindo do client sem validar que pertence ao workspace.
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
      name,
      description,
      status: "draft",
    })
    .select("id")
    .single();

  if (automationError || !automation) {
    return NextResponse.json({ error: "DB_ERROR", detail: automationError?.message }, { status: 500 });
  }

  const { error: versionError } = await admin.from("automation_versions").insert({
    automation_id: automation.id,
    version: 1,
    status: "draft",
    graph: compileFlowToGraph(EMPTY_FLOW) as never,
  });

  if (versionError) {
    return NextResponse.json({ error: "DB_ERROR", detail: versionError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: automation.id });
}
