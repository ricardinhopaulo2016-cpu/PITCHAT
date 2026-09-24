import { NextResponse } from "next/server";
import { getQstashReceiver, getAppUrl } from "@/lib/qstash";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { advanceRun, claimWaitingRun } from "@/lib/automation/engine";
import { decryptToken } from "@/lib/meta/token-crypto";
import { realMetaClient } from "@/lib/meta/client";
import type { Graph } from "@/lib/automation/graph";
import type { ExecutionContext } from "@/lib/automation/node-handlers";

export const runtime = "nodejs";

/**
 * Callback do QStash pro node DELAY **e** pro retry de erro RETRYABLE (ver
 * lib/automation/retry-policy.ts) — só o QStash chama isso (assinatura
 * verificada). Os dois pausam a run do mesmo jeito (`status=waiting`,
 * `cursor_node_id`), só o `waiting_reason` e o node de retomada diferem:
 * DELAY segue pro PRÓXIMO node (o delay já "aconteceu"); retry reexecuta o
 * MESMO node que falhou (é ele que precisa rodar de novo).
 */
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
  // só um consegue avançar (seção 24/25 do briefing). Tenta os dois motivos
  // de espera possíveis pra este endpoint; qual bateu decide o node de
  // retomada logo abaixo.
  let run = await claimWaitingRun(admin, automationRunId, "delay");
  let waitingReason: "delay" | "retry" = "delay";
  if (!run) {
    run = await claimWaitingRun(admin, automationRunId, "retry");
    waitingReason = "retry";
  }
  if (!run) {
    return NextResponse.json({ ok: true, alreadyResumedOrNotFound: true });
  }

  // Tudo daqui pra baixo roda com o run já em 'running' (claim feito). Sem
  // try/catch, qualquer exceção (ex: META_TOKEN_ENCRYPTION_KEY ausente,
  // conversation/social_account não encontrados) derrubava a request com
  // 500 e deixava o run travado pra sempre em 'running' — claimWaitingRun só
  // reivindica quando status='waiting', então nunca mais seria retomado, e o
  // retry do QStash reportava "sucesso" (alreadyResumedOrNotFound) mascarando
  // a falha real. Descoberto testando contra a infraestrutura real em
  // 09/09/2026 — nunca mais deixar um run morrer silenciosamente.
  try {
    const { data: runDetails, error: runDetailsError } = await admin
      .from("automation_runs")
      .select("automation_version_id")
      .eq("id", run.id)
      .single();
    if (runDetailsError || !runDetails) throw new Error(`Falha ao recarregar run: ${runDetailsError?.message}`);

    const { data: version, error: versionError } = await admin
      .from("automation_versions")
      .select("graph")
      .eq("id", runDetails.automation_version_id)
      .single();
    if (versionError || !version) throw new Error(`Versão não encontrada: ${versionError?.message}`);

    const { data: conversation, error: conversationError } = await admin
      .from("conversations")
      .select("social_account_id, automation_enabled, contact:contacts(platform_user_id)")
      .eq("id", run.conversation_id)
      .single();
    if (conversationError || !conversation) {
      throw new Error(`Conversation não encontrada: ${conversationError?.message}`);
    }

    // Human takeover (achado real 24/09/2026): um DELAY/retry agendado antes
    // do takeover não deve mandar mensagem nenhuma depois que um humano
    // assumiu. Devolve a run pro estado 'waiting' de onde saiu (nunca
    // 'failed' — não é uma falha, é uma pausa deliberada) e registra
    // explicitamente por quê, nunca silencioso.
    if (conversation.automation_enabled === false) {
      // As 3 escritas não dependem uma da outra — todas só precisam de
      // `run`/`waitingReason`, já resolvidos. audit_logs aqui é observabilidade
      // pura (Master Sync Adendo 02 §3): não muda a run nem o retorno da
      // request, só deixa visível quando isso acontecer de verdade.
      await Promise.all([
        admin.from("automation_run_steps").insert({
          automation_run_id: run.id,
          node_id: run.cursor_node_id ?? "unknown",
          node_type: waitingReason === "retry" ? "RETRY_RESUME" : "DELAY_RESUME",
          status: "skipped",
          error: { message: "Conversa em human takeover — resume não avançou." },
          completed_at: new Date().toISOString(),
        }),
        admin
          .from("automation_runs")
          .update({ status: "waiting", waiting_reason: waitingReason, updated_at: new Date().toISOString() })
          .eq("id", run.id),
        admin.from("audit_logs").insert({
          workspace_id: run.workspace_id,
          action: "automation.yielded_to_human",
          entity_type: "automation_run",
          entity_id: run.id,
          after: { waiting_reason: waitingReason, conversation_id: run.conversation_id },
        }),
      ]);
      return NextResponse.json({ ok: true, skipped: "AUTOMATION_DISABLED_HUMAN_TAKEOVER" });
    }

    const { data: socialAccount, error: socialAccountError } = await admin
      .from("social_accounts")
      .select("id, external_account_id, access_token_encrypted")
      .eq("id", conversation.social_account_id)
      .single();
    if (socialAccountError || !socialAccount || !socialAccount.access_token_encrypted) {
      throw new Error(`Social account não encontrada/sem token: ${socialAccountError?.message}`);
    }

    const graph = version.graph as Graph;
    const cursorNodeId = run.cursor_node_id!;
    // DELAY: o delay já "aconteceu", segue pro PRÓXIMO node. Retry: reexecuta
    // o MESMO node que falhou (é ele que precisa rodar de novo).
    const nextEdge = graph.edges.find((e) => e.from === cursorNodeId);
    const startNodeId = waitingReason === "retry" ? cursorNodeId : (nextEdge?.to ?? cursorNodeId);

    // PUBLIC_REPLY/PRIVATE_REPLY (retry) precisam do comment_id original —
    // não fica no `context` do run, mas `trigger_ref_id` já guarda o
    // external_comment_id desde a criação da run (ver lib/automation/
    // ingest.ts::createRun) quando trigger_source é 'comment'.
    const commentId = run.trigger_source === "comment" ? (run.trigger_ref_id ?? null) : null;

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
        id: socialAccount.id,
        externalAccountId: socialAccount.external_account_id,
        accessToken: decryptToken(socialAccount.access_token_encrypted),
      },
      recipientId: (conversation.contact as unknown as { platform_user_id: string }).platform_user_id,
      commentId,
      ctx,
      startNodeId,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("automation_run_steps").insert({
      automation_run_id: run.id,
      node_id: run.cursor_node_id ?? "unknown",
      node_type: waitingReason === "retry" ? "RETRY_RESUME" : "DELAY_RESUME",
      status: "failed",
      error: { message },
      completed_at: new Date().toISOString(),
    });
    await admin
      .from("automation_runs")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", run.id);
    // 500 pro QStash retentar (útil se a causa for transiente, ex: timeout de
    // rede) — se for permanente (token ausente/inválido), o run já fica
    // 'failed' e não trava mais em 'running' zumbi.
    return NextResponse.json({ error: "RESUME_FAILED", detail: message }, { status: 500 });
  }
}
