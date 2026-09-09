import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadAutomationForWorkspace } from "@/lib/automation/repo";

export const runtime = "nodejs";

const VALID_TRANSITIONS: Record<string, string[]> = {
  draft: ["active", "archived"],
  active: ["paused", "archived"],
  paused: ["active", "archived"],
  archived: [], // arquivada é terminal no V1 — reativar exige duplicar
};

/** Ativar/pausar/arquivar — o botão "Activate" só é permitido com uma versão publicada (seção 29 do briefing). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const nextStatus = body?.status;
  if (!["active", "paused", "archived"].includes(nextStatus)) {
    return NextResponse.json({ error: "INVALID_STATUS" }, { status: 400 });
  }

  const automation = await loadAutomationForWorkspace(admin, id, auth.workspace.id);
  if (!automation) return NextResponse.json({ error: "AUTOMATION_NOT_FOUND" }, { status: 404 });

  if (!VALID_TRANSITIONS[automation.status]?.includes(nextStatus)) {
    return NextResponse.json(
      { error: "INVALID_TRANSITION", detail: `${automation.status} -> ${nextStatus} não é permitido` },
      { status: 400 }
    );
  }

  if (nextStatus === "active" && !automation.current_version_id) {
    return NextResponse.json(
      { error: "NO_PUBLISHED_VERSION", detail: "Publique uma versão antes de ativar a automação" },
      { status: 400 }
    );
  }

  const { error } = await admin
    .from("automations")
    .update({ status: nextStatus, updated_at: new Date().toISOString() })
    .eq("id", id);

  if (error) return NextResponse.json({ error: "DB_ERROR", detail: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, status: nextStatus });
}
