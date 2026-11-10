import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getLinkSecret, isBotUserAgent, isSafeRedirectUrl, parseTrackedToken } from "@/lib/links/tracked-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GraphNode = { id?: string; data?: { button?: { url?: unknown } } };

function notFound() {
  return new NextResponse("Link inválido ou expirado.", { status: 404, headers: { "Cache-Control": "no-store" } });
}

/**
 * Redirecionador do botão de link da DM. Grava o clique em link_clicks e
 * manda a pessoa para o link do nó. O destino vem do grafo da automação,
 * nunca do próprio link. Falha ao gravar não impede o redirecionamento.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const secret = getLinkSecret();
  const admin = getSupabaseAdminClient();
  if (!secret || !admin) return notFound();

  const parsed = parseTrackedToken(token, secret);
  if (!parsed) return notFound();

  const { data: run } = await admin
    .from("automation_runs")
    .select("id, workspace_id, automation_version_id")
    .eq("id", parsed.runId)
    .maybeSingle();
  if (!run) return notFound();

  const { data: version } = await admin.from("automation_versions").select("graph").eq("id", run.automation_version_id).maybeSingle();
  const nodes = (version?.graph as { nodes?: GraphNode[] } | null)?.nodes;
  const node = Array.isArray(nodes) ? nodes.find((n) => n?.id === parsed.nodeId) : undefined;
  const url = node?.data?.button?.url;
  if (typeof url !== "string" || !isSafeRedirectUrl(url)) return notFound();

  const userAgent = request.headers.get("user-agent");
  const { error } = await admin.from("link_clicks").insert({
    workspace_id: run.workspace_id,
    automation_run_id: run.id,
    node_id: parsed.nodeId,
    is_bot: isBotUserAgent(userAgent),
    user_agent: userAgent?.slice(0, 300) ?? null,
  });
  if (error) console.error("[r] falha ao gravar clique", error.message);

  return NextResponse.redirect(url, { status: 302, headers: { "Cache-Control": "no-store" } });
}
