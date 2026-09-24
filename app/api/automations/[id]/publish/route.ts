import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadAutomationForWorkspace, loadDraftVersion } from "@/lib/automation/repo";
import { computeGraphReviewHash, isReviewConfirmed } from "@/lib/automation/review-hash";

export const runtime = "nodejs";

/**
 * Publica a versão draft atual: vira 'published' (imutável a partir daí — ver
 * docs/PITCHAT_ARCHITECTURE.md §9, quem já está executando uma versão antiga
 * termina nela) e vira `automations.current_version_id`. Não muda
 * `automations.status` — publicar não é o mesmo que ativar (botão separado).
 *
 * Gate de revisão (B3, auditoria 24/09/2026 — foi possível publicar conteúdo
 * real inadequado sem revisão nenhuma): exige `{confirmed:true,
 * reviewedGraphHash}` batendo com o hash do draft de verdade. Enforçado aqui
 * no servidor, não só no client — um checkbox só na UI seria trivialmente
 * contornável chamando este endpoint direto.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const automation = await loadAutomationForWorkspace(admin, id, auth.workspace.id);
  if (!automation) return NextResponse.json({ error: "AUTOMATION_NOT_FOUND" }, { status: 404 });

  const draft = await loadDraftVersion(admin, id);
  if (!draft) return NextResponse.json({ error: "NO_DRAFT_TO_PUBLISH" }, { status: 400 });

  const body = await request.json().catch(() => ({}));
  const expectedHash = await computeGraphReviewHash(draft.graph);
  if (!isReviewConfirmed(body, expectedHash)) {
    // Sem confirmação nenhuma = REVIEW_NOT_CONFIRMED; confirmação de um
    // conteúdo que já não é mais o atual (editado em outra aba depois de
    // abrir o modal) = mesmo erro, mas o client trata como "conteúdo mudou"
    // (ver flow-editor.tsx) — o hash sempre diferencia os dois casos por
    // trás, não precisa de um código de erro a mais.
    return NextResponse.json({ error: body.confirmed ? "REVIEW_STALE" : "REVIEW_NOT_CONFIRMED" }, { status: 400 });
  }

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
