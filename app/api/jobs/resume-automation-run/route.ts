import { NextResponse } from "next/server";
import { getQstashReceiver, getAppUrl } from "@/lib/qstash";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { advanceRun, claimWaitingRun } from "@/lib/automation/engine";
import { decryptToken } from "@/lib/meta/token-crypto";
import { realMetaClient } from "@/lib/meta/client";
import type { Graph } from "@/lib/automation/graph";
import type { ExecutionContext } from "@/lib/automation/node-handlers";

export const runtime = "nodejs";

/** Callback do QStash pro node DELAY — só o QStash chama isso (assinatura verificada). */
export async function POST(request: Request) {
  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const receiver = getQstashReceiver();
  const appUrl = getAppUrl();
  if (!receiver || !appUrl) {
    return NextResponse.json({ error: "QSTASH_NOT_CONFIGURED" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const isValid = signature
    ? await receiver
        .verify({ signature, body: rawBody, url: `${appUrl}/api/jobs/resume-automation-run` })
        .catch(() => false)
    : false;
  if (!isValid) return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });

  const { automationRunId } = JSON.parse(rawBody) as { automationRunId?: string };
  if (!automationRunId) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  // Reivindica atomicamente — se dois callbacks chegarem (retry do QStash),
  // só um consegue avançar (seção 24/25 do briefing).
  const run = await claimWaitingRun(admin, automationRunId, "delay");
  if (!run) {
    return NextResponse.json({ ok: true, alreadyResumedOrNotFound: true });
  }

  const { data: runDetails } = await admin
    .from("automation_runs")
    .select("automation_version_id")
    .eq("id", run.id)
    .single();

  const { data: version } = await admin
    .from("automation_versions")
    .select("graph")
    .eq("id", runDetails!.automation_version_id)
    .single();

  const { data: conversation } = await admin
    .from("conversations")
    .select("social_account_id, contact:contacts(platform_user_id)")
    .eq("id", run.conversation_id)
    .single();

  const { data: socialAccount } = await admin
    .from("social_accounts")
    .select("id, external_account_id, access_token_encrypted")
    .eq("id", conversation!.social_account_id)
    .single();

  const graph = version!.graph as Graph;
  const delayNodeId = run.cursor_node_id!;
  const nextEdge = graph.edges.find((e) => e.from === delayNodeId);

  const ctx: ExecutionContext = {
    variables: run.context,
    contactTags: [],
    customFields: {},
    conversationAutomationEnabled: true,
  };

  await advanceRun(admin, realMetaClient, {
    run,
    graph,
    socialAccount: {
      id: socialAccount!.id,
      externalAccountId: socialAccount!.external_account_id,
      accessToken: decryptToken(socialAccount!.access_token_encrypted!),
    },
    recipientId: (conversation!.contact as unknown as { platform_user_id: string }).platform_user_id,
    commentId: null,
    ctx,
    startNodeId: nextEdge?.to ?? delayNodeId,
  });

  return NextResponse.json({ ok: true });
}
