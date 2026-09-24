import type { SupabaseClient } from "@supabase/supabase-js";
import { findNode, nextNode, type Graph } from "./graph";
import { evaluateNode, type ExecutionContext } from "./node-handlers";
import { MetaApiError, type MetaClient } from "@/lib/meta/client";
import { checkUrlAllowed } from "./ssrf-guard";
import { getRetryBackoffMinutes } from "./retry-policy";
import * as qstash from "@/lib/qstash";

const MAX_STEPS_PER_INVOCATION = 50; // trava de segurança contra loop infinito num grafo mal configurado

export type SocialAccountForEngine = {
  id: string;
  externalAccountId: string; // IGSID da conta profissional
  accessToken: string;
};

export type AutomationRunRow = {
  id: string;
  workspace_id: string;
  contact_id: string | null;
  conversation_id: string | null;
  status: string;
  cursor_node_id: string | null;
  waiting_reason: string | null;
  context: Record<string, unknown>;
  // Presentes na linha real (claimWaitingRun faz `.select()` sem args, que
  // já traz todas as colunas) — tipados aqui só pra quem precisa reconstruir
  // o commentId ao retomar um retry num node PUBLIC_REPLY/PRIVATE_REPLY (ver
  // app/api/jobs/resume-automation-run/route.ts).
  trigger_source?: string;
  trigger_ref_id?: string | null;
};

export type AdvanceParams = {
  run: AutomationRunRow;
  graph: Graph;
  socialAccount: SocialAccountForEngine;
  /** IGSID de quem está do outro lado da conversa — destino de DM/reply. */
  recipientId: string;
  /** external_comment_id, quando o run nasceu de um comentário (pra PUBLIC_REPLY/PRIVATE_REPLY). */
  commentId: string | null;
  ctx: ExecutionContext;
  /** Node por onde começar. Omitido = começa do zero pelo primeiro TRIGGER_COMMENT do grafo. */
  startNodeId?: string;
};

/**
 * Formato do payload de quick reply que A GENTE controla (nunca o título do
 * botão) — ver seção 14 do briefing. `runId:nodeId:optionKey`.
 */
export function buildQuickReplyPayload(runId: string, nodeId: string, optionKey: string): string {
  return `${runId}:${nodeId}:${optionKey}`;
}

export function parseQuickReplyPayload(
  payload: string
): { runId: string; nodeId: string; optionKey: string } | null {
  const parts = payload.split(":");
  if (parts.length !== 3) return null;
  const [runId, nodeId, optionKey] = parts;
  if (!runId || !nodeId || !optionKey) return null;
  return { runId, nodeId, optionKey };
}

async function logStep(
  admin: SupabaseClient,
  runId: string,
  nodeId: string,
  nodeType: string,
  status: "succeeded" | "failed" | "skipped",
  input: unknown,
  output: unknown,
  error?: unknown,
  attempt = 1
) {
  await admin.from("automation_run_steps").insert({
    automation_run_id: runId,
    node_id: nodeId,
    node_type: nodeType,
    status,
    input: input as never,
    output: output as never,
    error: error ? { message: error instanceof Error ? error.message : String(error) } : null,
    attempt,
    completed_at: new Date().toISOString(),
  });
}

/** Quantas vezes ESTE node já falhou nesta run — base pro cálculo de backoff do retry. */
async function countFailedAttempts(admin: SupabaseClient, runId: string, nodeId: string): Promise<number> {
  const { count } = await admin
    .from("automation_run_steps")
    .select("id", { count: "exact", head: true })
    .eq("automation_run_id", runId)
    .eq("node_id", nodeId)
    .eq("status", "failed");
  return count ?? 0;
}

async function updateRun(
  admin: SupabaseClient,
  runId: string,
  patch: Partial<{
    status: string;
    cursor_node_id: string | null;
    waiting_reason: string | null;
    context: Record<string, unknown>;
    completed_at: string;
  }>
) {
  await admin
    .from("automation_runs")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", runId);
}

/**
 * Percorre o grafo a partir de `startNodeId` (ou do cursor do run) até
 * terminar (END), pausar (QUICK_REPLY/DELAY) ou falhar. Idempotência de
 * concorrência: quem chama `advance` numa run que estava 'waiting' deve
 * primeiro "reivindicar" a run com um UPDATE condicional (ver
 * claimWaitingRun) — se dois webhooks chegarem quase juntos, só um consegue
 * a claim, o outro vira no-op.
 */
export async function advanceRun(
  admin: SupabaseClient,
  meta: MetaClient,
  params: AdvanceParams
): Promise<void> {
  const { run, graph, socialAccount, recipientId, commentId } = params;
  let ctx = params.ctx;
  let currentNode = params.startNodeId
    ? findNode(graph, params.startNodeId)
    : graph.nodes.find((n) => n.type === "TRIGGER_COMMENT");

  if (!currentNode) {
    await updateRun(admin, run.id, { status: "failed" });
    await logStep(admin, run.id, "unknown", "UNKNOWN", "failed", null, null, "start node not found");
    return;
  }

  let branchLabel: string | undefined;

  for (let steps = 0; steps < MAX_STEPS_PER_INVOCATION; steps++) {
    const outcome = evaluateNode(currentNode, ctx);

    try {
      switch (outcome.kind) {
        case "continue": {
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", ctx.triggerText, null);
          break;
        }

        case "no_match": {
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", ctx.triggerText, {
            matched: false,
          });
          await updateRun(admin, run.id, {
            status: "completed",
            completed_at: new Date().toISOString(),
          });
          return;
        }

        case "public_reply": {
          if (!commentId) throw new Error("PUBLIC_REPLY sem commentId no contexto do run");
          await meta.sendPublicReply({
            accessToken: socialAccount.accessToken,
            commentId,
            text: outcome.text,
          });
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", null, {
            text: outcome.text,
          });
          break;
        }

        case "private_reply": {
          if (!commentId) throw new Error("PRIVATE_REPLY sem commentId no contexto do run");
          const hasQuickReply = !!outcome.quickReplyOptions?.length;
          const quickReplies = outcome.quickReplyOptions?.map((o) => ({
            title: o.title,
            payload: buildQuickReplyPayload(run.id, currentNode!.id, o.key),
          }));
          const result = await meta.sendPrivateReply({
            accessToken: socialAccount.accessToken,
            igUserId: socialAccount.externalAccountId,
            commentId,
            text: outcome.text,
            ...(quickReplies ? { quickReplies } : {}),
          });
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", null, result as never);
          if (hasQuickReply) {
            // Mesma pausa do node QUICK_REPLY (ver caso abaixo) — o botão
            // veio junto NESTA mensagem em vez de numa próxima separada, mas
            // o mecanismo de retomada é idêntico: o payload do botão já
            // aponta pra este node id, então `nextAfter` funciona igual.
            await updateRun(admin, run.id, {
              status: "waiting",
              waiting_reason: "quick_reply",
              cursor_node_id: currentNode.id,
              context: ctx.variables,
            });
            return;
          }
          break;
        }

        case "send_message": {
          const result = outcome.button
            ? await meta.sendButtonTemplate({
                accessToken: socialAccount.accessToken,
                igUserId: socialAccount.externalAccountId,
                recipientId,
                text: outcome.text,
                buttons: [{ type: "web_url", title: outcome.button.title, url: outcome.button.url }],
              })
            : await meta.sendTextMessage({
                accessToken: socialAccount.accessToken,
                igUserId: socialAccount.externalAccountId,
                recipientId,
                text: outcome.text,
              });
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", null, result as never);
          break;
        }

        case "quick_reply": {
          const optionsWithPayload = outcome.options.map((o) => ({
            title: o.title,
            payload: buildQuickReplyPayload(run.id, currentNode!.id, o.key),
          }));
          const result = await meta.sendQuickReplies({
            accessToken: socialAccount.accessToken,
            igUserId: socialAccount.externalAccountId,
            recipientId,
            text: outcome.text,
            options: optionsWithPayload,
          });
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", null, result as never);
          await updateRun(admin, run.id, {
            status: "waiting",
            waiting_reason: "quick_reply",
            cursor_node_id: currentNode.id,
            context: ctx.variables,
          });
          return; // pausa — só retoma quando o webhook de postback chegar
        }

        case "delay": {
          const scheduled = await qstash.scheduleAutomationResume({
            automationRunId: run.id,
            minutes: outcome.minutes,
            deduplicationId: `delay:${run.id}:${currentNode.id}`,
          });
          await logStep(
            admin,
            run.id,
            currentNode.id,
            currentNode.type,
            scheduled.ok ? "succeeded" : "failed",
            { minutes: outcome.minutes },
            scheduled.ok ? { messageId: scheduled.messageId } : null,
            scheduled.ok ? undefined : scheduled.reason
          );
          if (!scheduled.ok) {
            await updateRun(admin, run.id, { status: "failed" });
            return;
          }
          await updateRun(admin, run.id, {
            status: "waiting",
            waiting_reason: "delay",
            cursor_node_id: currentNode.id,
            context: ctx.variables,
          });
          return; // pausa — só retoma quando o callback do QStash chegar
        }

        case "branch": {
          branchLabel = outcome.label;
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", null, {
            branch: outcome.label,
          });
          break;
        }

        case "add_tag": {
          await addTag(admin, run.workspace_id, run.contact_id, outcome.tagName);
          ctx = { ...ctx, contactTags: [...new Set([...ctx.contactTags, outcome.tagName])] };
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", null, {
            tagName: outcome.tagName,
          });
          break;
        }

        case "remove_tag": {
          await removeTag(admin, run.contact_id, outcome.tagName);
          ctx = { ...ctx, contactTags: ctx.contactTags.filter((t) => t !== outcome.tagName) };
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", null, {
            tagName: outcome.tagName,
          });
          break;
        }

        case "set_custom_field": {
          ctx = {
            ...ctx,
            customFields: { ...ctx.customFields, [outcome.key]: outcome.value },
          };
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", null, {
            key: outcome.key,
            value: outcome.value,
          });
          break;
        }

        case "http_request": {
          const check = checkUrlAllowed(outcome.url);
          if (!check.allowed) {
            throw new Error(`HTTP_REQUEST bloqueado: ${check.reason}`);
          }
          const res = await fetch(outcome.url, {
            method: outcome.method,
            headers: outcome.headers,
            body: outcome.body ? JSON.stringify(outcome.body) : undefined,
          });
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", outcome, {
            status: res.status,
          });
          break;
        }

        case "end": {
          await logStep(admin, run.id, currentNode.id, currentNode.type, "succeeded", null, null);
          await updateRun(admin, run.id, {
            status: "completed",
            completed_at: new Date().toISOString(),
          });
          return;
        }
      }
    } catch (err) {
      // Erro RETRYABLE (rate limit, 5xx da Meta — ver classifyMetaError):
      // reagenda o MESMO node via QStash em vez de falhar de vez. NON_RETRYABLE
      // (token inválido, requisição malformada) nunca passa por aqui — cai
      // direto pro failed definitivo abaixo, retry não ajudaria.
      if (err instanceof MetaApiError && err.kind === "RETRYABLE") {
        const priorFailures = await countFailedAttempts(admin, run.id, currentNode.id);
        const attemptNumber = priorFailures + 1; // 1 = esta primeira falha, 2 = segunda, ...
        const backoffMinutes = getRetryBackoffMinutes(attemptNumber);

        if (backoffMinutes !== null) {
          await logStep(admin, run.id, currentNode.id, currentNode.type, "failed", null, null, err, attemptNumber);
          const scheduled = await qstash.scheduleAutomationResume({
            automationRunId: run.id,
            minutes: backoffMinutes,
            deduplicationId: `retry:${run.id}:${currentNode.id}:${attemptNumber}`,
          });
          if (scheduled.ok) {
            await updateRun(admin, run.id, {
              status: "waiting",
              waiting_reason: "retry",
              cursor_node_id: currentNode.id,
              context: ctx.variables,
            });
            return; // pausa — só retoma quando o callback do QStash chegar
          }
          // Não conseguiu nem agendar o retry (QStash não configurado, etc)
          // — cai pro failed definitivo abaixo, nunca finge que vai tentar
          // de novo sozinho.
        }
        // Esgotou MAX_RETRY_ATTEMPTS — falha de vez, nunca retenta pra sempre.
      }

      await logStep(admin, run.id, currentNode.id, currentNode.type, "failed", null, null, err);
      await updateRun(admin, run.id, { status: "failed" });
      return;
    }

    const next = nextNode(graph, currentNode.id, branchLabel);
    branchLabel = undefined;
    if (!next) {
      await updateRun(admin, run.id, { status: "completed", completed_at: new Date().toISOString() });
      return;
    }
    currentNode = next;
  }

  // Estourou o limite de steps num único invocation — grafo provavelmente
  // tem um ciclo. Falha explícito, nunca trava o processo em loop infinito.
  await updateRun(admin, run.id, { status: "failed" });
  await logStep(
    admin,
    run.id,
    currentNode.id,
    currentNode.type,
    "failed",
    null,
    null,
    `excedeu ${MAX_STEPS_PER_INVOCATION} steps numa única execução — grafo provavelmente tem ciclo`
  );
}

async function addTag(
  admin: SupabaseClient,
  workspaceId: string,
  contactId: string | null,
  tagName: string
) {
  if (!contactId) return;
  const { data: tag } = await admin
    .from("tags")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("name", tagName)
    .maybeSingle();

  const tagId =
    tag?.id ??
    (
      await admin
        .from("tags")
        .insert({ workspace_id: workspaceId, name: tagName })
        .select("id")
        .single()
    ).data?.id;

  if (tagId) {
    await admin.from("contact_tags").upsert({ contact_id: contactId, tag_id: tagId }, { onConflict: "contact_id,tag_id" });
  }
}

async function removeTag(admin: SupabaseClient, contactId: string | null, tagName: string) {
  if (!contactId) return;
  const { data: tag } = await admin.from("tags").select("id").eq("name", tagName).maybeSingle();
  if (tag) {
    await admin.from("contact_tags").delete().eq("contact_id", contactId).eq("tag_id", tag.id);
  }
}

/**
 * "Reivindica" um run que estava esperando, de forma atômica — evita dois
 * webhooks quase simultâneos avançarem o mesmo run duas vezes (seção 25 do
 * briefing). Se outro processo já reivindicou, retorna null (no-op seguro).
 */
export async function claimWaitingRun(
  admin: SupabaseClient,
  runId: string,
  expectedWaitingReason: string
): Promise<AutomationRunRow | null> {
  const { data, error } = await admin
    .from("automation_runs")
    .update({ status: "running", updated_at: new Date().toISOString() })
    .eq("id", runId)
    .eq("status", "waiting")
    .eq("waiting_reason", expectedWaitingReason)
    .select()
    .maybeSingle<AutomationRunRow>();

  if (error || !data) return null;
  return data;
}
