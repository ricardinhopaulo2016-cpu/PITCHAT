import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaClient } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/token-crypto";
import type { InstagramCommentReceived, InstagramMessageReceived, InstagramQuickReplyReceived } from "@/lib/meta/events";
import { advanceRun, claimWaitingRun, parseQuickReplyPayload, type SocialAccountForEngine } from "./engine";
import { recordInboundMessage } from "./messages";
import { nextNode, resumeTargetId, type Graph } from "./graph";
import { evaluateNode, type ExecutionContext } from "./node-handlers";

/** Até quanto tempo depois do insert um comentário já gravado ainda pode ser retomado por retry. */
const RETRY_RECOVERY_WINDOW_MS = 60 * 60 * 1000;

type SocialAccountRow = {
  id: string;
  workspace_id: string;
  profile_id: string;
  external_account_id: string;
  access_token_encrypted: string | null;
};

/**
 * Comentário chegou → acha/cria contato → grava o comentário (idempotente
 * por social_account+external_comment_id) → conversa → dispara toda
 * automação ACTIVE do perfil, cada uma no seu próprio automation_run.
 * Ver seção 8 do briefing.
 */
export async function ingestInstagramComment(
  admin: SupabaseClient,
  meta: MetaClient,
  socialAccount: SocialAccountRow,
  event: InstagramCommentReceived
): Promise<{ processed: boolean; reason?: string }> {
  // Nunca reagir a comentário feito pela própria conta profissional — evita
  // loop com a resposta pública que o próprio PUBLIC_REPLY posta (a Meta
  // manda webhook de volta pra ela também) e qualquer comentário manual
  // que o operador fizer com a conta do perfil.
  if (event.fromUserId && event.fromUserId === socialAccount.external_account_id) {
    return { processed: false, reason: "IGNORED_OWN_COMMENT" };
  }

  if (!socialAccount.access_token_encrypted) {
    return { processed: false, reason: "SOCIAL_ACCOUNT_NOT_CONNECTED" };
  }

  const contact = await upsertContact(admin, socialAccount.workspace_id, event.fromUserId, event.fromUsername);

  // Idempotência: se o comentário já existe (mesmo social_account +
  // external_comment_id), não dispara automação de novo — Meta pode
  // reenviar o mesmo webhook mais de uma vez (seção 24 do briefing).
  const { data: insertedComment, error: commentError } = await admin
    .from("comments")
    .upsert(
      {
        workspace_id: socialAccount.workspace_id,
        social_account_id: socialAccount.id,
        contact_id: contact.id,
        external_comment_id: event.externalCommentId,
        external_media_id: event.externalMediaId,
        parent_comment_id: event.parentCommentId,
        text: event.text,
        raw_payload: event as never,
      },
      { onConflict: "social_account_id,external_comment_id", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  // Lança em vez de devolver motivo: a rota do QStash ignora o retorno e
  // marcaria o evento como processado, sem retentar.
  if (commentError) throw new Error(`Falha ao gravar comentário: ${commentError.message}`);

  // Comentário já gravado pode ser reenvio da Meta ou retry de um worker que
  // caiu depois do insert e antes de disparar. Dentro da janela, segue: a
  // unique de automation_runs garante que automação já disparada não repete.
  // Fora dela, ignora, para automação ativada depois não pegar comentário antigo.
  if (!insertedComment) {
    const { data: existing } = await admin
      .from("comments")
      .select("created_at")
      .eq("social_account_id", socialAccount.id)
      .eq("external_comment_id", event.externalCommentId)
      .maybeSingle();
    const createdAt = (existing as { created_at?: string } | null)?.created_at;
    const withinRecovery = !!createdAt && Date.now() - new Date(createdAt).getTime() <= RETRY_RECOVERY_WINDOW_MS;
    if (!withinRecovery) return { processed: false, reason: "DUPLICATE_COMMENT_IGNORED" };
  }

  // Horário real do comentário no Instagram: o webhook não traz, então busca
  // na Graph API. Só no primeiro insert, e nunca derruba a automação: sem
  // horário, a coluna fica null e as métricas caem na hora de gravação.
  if (insertedComment && meta.getCommentTimestamp) {
    try {
      const sourceCreatedAt = await meta.getCommentTimestamp({
        accessToken: decryptToken(socialAccount.access_token_encrypted),
        commentId: event.externalCommentId,
      });
      if (sourceCreatedAt) {
        await admin
          .from("comments")
          .update({ source_created_at: sourceCreatedAt })
          .eq("id", (insertedComment as { id: string }).id)
          .eq("workspace_id", socialAccount.workspace_id);
      }
    } catch {
      // Best-effort: falha da Meta ou do banco aqui não pode impedir o disparo.
    }
  }

  const conversation = await upsertConversation(admin, socialAccount.workspace_id, socialAccount.id, contact.id);

  // Human takeover (achado real 24/09/2026): antes disso, automation_enabled
  // só era consultado DENTRO de um CONDITION node opcional — uma automação
  // sem esse node ignorava completamente que um humano assumiu a conversa.
  // Agora é um portão de verdade: nenhuma automação nova dispara pra essa
  // conversa enquanto automation_enabled=false. O comentário/contato/
  // conversa continuam sendo gravados normalmente — só a automação não roda.
  // `=== false` de propósito (nunca `!conversation.automation_enabled`) —
  // só bloqueia com um valor EXPLICITAMENTE false; qualquer coisa ambígua
  // (null/undefined) nunca deveria acontecer de verdade (a coluna tem
  // `default true`), mas se acontecesse, falhar aberto (automação roda) é
  // sempre menos surpreendente que falhar fechado (automação para sem
  // ninguém ter pedido).
  if (conversation.automation_enabled === false) {
    return { processed: false, reason: "AUTOMATION_DISABLED_HUMAN_TAKEOVER" };
  }

  const automations = await loadActiveAutomations(admin, socialAccount.profile_id, socialAccount.id);
  const socialAccountForEngine: SocialAccountForEngine = {
    id: socialAccount.id,
    externalAccountId: socialAccount.external_account_id,
    accessToken: decryptToken(socialAccount.access_token_encrypted),
  };

  for (const automation of automations) {
    const ctx: ExecutionContext = {
      variables: {},
      triggerText: event.text,
      contactTags: [],
      customFields: {},
      conversationAutomationEnabled: conversation.automation_enabled,
    };

    // Comentário fora da keyword não vira run: assim "runs" conta disparo de
    // verdade, e não todo comentário do perfil.
    if (!entryKeywordMatches(automation.graph, ctx)) continue;

    const run = await createRun(admin, {
      workspaceId: socialAccount.workspace_id,
      automationId: automation.automationId,
      automationVersionId: automation.automationVersionId,
      conversationId: conversation.id,
      contactId: contact.id,
      triggerSource: "comment",
      triggerRefId: event.externalCommentId,
    });
    if (!run) continue; // outro worker ou tentativa anterior já disparou esta automação

    await advanceRun(admin, meta, {
      run,
      graph: automation.graph,
      socialAccount: socialAccountForEngine,
      recipientId: event.fromUserId,
      commentId: event.externalCommentId,
      ctx,
    });
  }

  return { processed: true };
}

/** Postback/quick reply clicado — retoma exatamente o run que mandou aquele botão. */
export async function ingestInstagramQuickReply(
  admin: SupabaseClient,
  meta: MetaClient,
  socialAccount: SocialAccountRow,
  event: InstagramQuickReplyReceived
): Promise<{ processed: boolean; reason?: string }> {
  if (!socialAccount.access_token_encrypted) {
    return { processed: false, reason: "SOCIAL_ACCOUNT_NOT_CONNECTED" };
  }

  const parsed = parseQuickReplyPayload(event.payload);
  if (!parsed) return { processed: false, reason: "PAYLOAD_NAO_RECONHECIDO" };

  const run = await claimWaitingRun(admin, parsed.runId, "quick_reply");
  if (!run) return { processed: false, reason: "RUN_JA_RETOMADO_OU_NAO_ENCONTRADO" }; // idempotência: outro webhook já pegou

  // O clique é real independente do que a gente decidir fazer com ele —
  // grava sempre, mesmo se a automação estiver pausada por human takeover
  // (ver checagem logo abaixo). `run.conversation_id` já vem da própria
  // claimWaitingRun (select() sem args traz todas as colunas).
  if (run.conversation_id) {
    await recordInboundMessage(admin, {
      workspaceId: run.workspace_id,
      conversationId: run.conversation_id,
      externalMessageId: event.externalMessageId,
      type: "quick_reply",
      text: event.buttonTitle,
      payload: { payload: event.payload },
    });
  }

  // Human takeover (achado real 24/09/2026): se um humano assumiu a
  // conversa DEPOIS que o botão foi mandado mas ANTES do clique chegar, a
  // automação não deve retomar sozinha — o clique fica registrado (acima),
  // mas a run não avança. Nunca comportamento ambíguo: falha explícito, não
  // finge que rodou.
  if (run.conversation_id) {
    const { data: conversation } = await admin
      .from("conversations")
      .select("automation_enabled")
      .eq("id", run.conversation_id)
      .maybeSingle();
    if (conversation && conversation.automation_enabled === false) {
      await admin.from("automation_run_steps").insert({
        automation_run_id: run.id,
        node_id: parsed.nodeId,
        node_type: "QUICK_REPLY_RESUME",
        status: "skipped",
        error: { message: "Conversa em human takeover — clique registrado, automação não retomada." },
        completed_at: new Date().toISOString(),
      });
      // Devolve a run pro estado 'waiting' de onde saiu — claimWaitingRun já
      // marcou 'running' otimisticamente; sem isso ela ficaria presa em
      // 'running' pra sempre (mesmo bug de fundo já documentado nesta rota).
      await admin
        .from("automation_runs")
        .update({ status: "waiting", waiting_reason: "quick_reply", updated_at: new Date().toISOString() })
        .eq("id", run.id);
      return { processed: false, reason: "AUTOMATION_DISABLED_HUMAN_TAKEOVER" };
    }
  }

  // Mesmo cuidado do node DELAY (ver app/api/jobs/resume-automation-run):
  // sem try/catch aqui, uma exceção depois do claim (token ausente, versão
  // não encontrada, etc.) deixava o run travado pra sempre em 'running' —
  // claimWaitingRun só reivindica de 'waiting', então nunca mais seria
  // retomado. Descoberto testando a infraestrutura real em 09/09/2026.
  try {
    const { data: automationRun, error: automationRunError } = await admin
      .from("automation_runs")
      .select("automation_version_id, contact_id")
      .eq("id", run.id)
      .single();
    if (automationRunError || !automationRun) {
      throw new Error(`Falha ao recarregar run: ${automationRunError?.message}`);
    }

    const { data: version, error: versionError } = await admin
      .from("automation_versions")
      .select("graph")
      .eq("id", automationRun.automation_version_id)
      .single();
    if (versionError || !version) throw new Error(`Versão não encontrada: ${versionError?.message}`);

    const socialAccountForEngine: SocialAccountForEngine = {
      id: socialAccount.id,
      externalAccountId: socialAccount.external_account_id,
      accessToken: decryptToken(socialAccount.access_token_encrypted!),
    };

    const ctx: ExecutionContext = {
      variables: run.context,
      quickReplyOptionKey: parsed.optionKey,
      contactTags: [],
      customFields: {},
      conversationAutomationEnabled: true,
    };

    await advanceRun(admin, meta, {
      run,
      graph: version.graph as Graph,
      socialAccount: socialAccountForEngine,
      recipientId: event.fromUserId,
      commentId: null,
      ctx,
      startNodeId: resumeTargetId(version.graph as Graph, parsed.nodeId, parsed.nodeId, parsed.optionKey),
    });

    return { processed: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await admin.from("automation_run_steps").insert({
      automation_run_id: run.id,
      node_id: parsed.nodeId,
      node_type: "QUICK_REPLY_RESUME",
      status: "failed",
      error: { message },
      completed_at: new Date().toISOString(),
    });
    await admin
      .from("automation_runs")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("id", run.id);
    return { processed: false, reason: `RESUME_FAILED: ${message}` };
  }
}

/**
 * DM avulsa recebida (sem quick reply) — achado real 24/09/2026: até aqui
 * era completamente ignorada (nem contact/conversation eram tocados),
 * então uma resposta manual do usuário no Inbox era invisível pra sempre.
 * Continua NÃO disparando nenhuma automação (trigger suportado no V1 é só
 * comentário) — só grava a mensagem real, pro Inbox mostrar de verdade.
 */
export async function ingestInstagramMessage(
  admin: SupabaseClient,
  socialAccount: SocialAccountRow,
  event: InstagramMessageReceived
): Promise<{ processed: boolean; reason?: string }> {
  if (event.fromUserId && event.fromUserId === socialAccount.external_account_id) {
    return { processed: false, reason: "IGNORED_OWN_MESSAGE" }; // eco da própria mensagem que a gente mandou
  }

  const contact = await upsertContact(admin, socialAccount.workspace_id, event.fromUserId, null);
  const conversation = await upsertConversation(admin, socialAccount.workspace_id, socialAccount.id, contact.id);

  await recordInboundMessage(admin, {
    workspaceId: socialAccount.workspace_id,
    conversationId: conversation.id,
    externalMessageId: event.externalMessageId,
    type: "text",
    text: event.text,
  });

  return { processed: true };
}

async function upsertContact(
  admin: SupabaseClient,
  workspaceId: string,
  platformUserId: string,
  username: string | null
) {
  const now = new Date().toISOString();
  const { data: existing } = await admin
    .from("contacts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("platform", "instagram")
    .eq("platform_user_id", platformUserId)
    .maybeSingle();

  if (existing) {
    await admin.from("contacts").update({ last_seen_at: now, username }).eq("id", existing.id);
    return existing;
  }

  const { data: created } = await admin
    .from("contacts")
    .insert({
      workspace_id: workspaceId,
      platform: "instagram",
      platform_user_id: platformUserId,
      username,
      first_seen_at: now,
      last_seen_at: now,
    })
    .select("id")
    .single();

  return created!;
}

async function upsertConversation(
  admin: SupabaseClient,
  workspaceId: string,
  socialAccountId: string,
  contactId: string
) {
  const { data: existing } = await admin
    .from("conversations")
    .select("id, automation_enabled")
    .eq("social_account_id", socialAccountId)
    .eq("contact_id", contactId)
    .maybeSingle();
  if (existing) return existing;

  const { data: created } = await admin
    .from("conversations")
    .insert({ workspace_id: workspaceId, social_account_id: socialAccountId, contact_id: contactId })
    .select("id, automation_enabled")
    .single();
  return created!;
}

/** Automações ativas que valem para ESTA conta: as dela e as sem conta definida (valem para o profile todo). */
async function loadActiveAutomations(admin: SupabaseClient, profileId: string, socialAccountId: string) {
  const { data } = await admin
    .from("automations")
    .select("id, social_account_id, current_version_id, automation_versions!automations_current_version_fk(graph)")
    .eq("profile_id", profileId)
    .eq("status", "active")
    .not("current_version_id", "is", null);

  return (data ?? [])
    .filter((row: Record<string, unknown>) => !row.social_account_id || row.social_account_id === socialAccountId)
    .map((row: Record<string, unknown>) => ({
      automationId: row.id as string,
      automationVersionId: row.current_version_id as string,
      graph: (row.automation_versions as { graph: Graph }).graph,
    }));
}

/** Se o nó logo após o trigger é KEYWORD_MATCH, avalia antes de abrir a run. Outro formato de grafo segue para o engine. */
function entryKeywordMatches(graph: Graph, ctx: ExecutionContext): boolean {
  const trigger = graph.nodes.find((n) => n.type === "TRIGGER_COMMENT");
  if (!trigger) return true;
  const first = nextNode(graph, trigger.id);
  if (first?.type !== "KEYWORD_MATCH") return true;
  return evaluateNode(first, ctx).kind !== "no_match";
}

async function createRun(
  admin: SupabaseClient,
  params: {
    workspaceId: string;
    automationId: string;
    automationVersionId: string;
    conversationId: string;
    contactId: string;
    triggerSource: "comment" | "message" | "postback";
    triggerRefId: string;
  }
) {
  const { data, error } = await admin
    .from("automation_runs")
    .upsert(
      {
        workspace_id: params.workspaceId,
        automation_id: params.automationId,
        automation_version_id: params.automationVersionId,
        conversation_id: params.conversationId,
        contact_id: params.contactId,
        trigger_source: params.triggerSource,
        trigger_ref_id: params.triggerRefId,
        status: "running",
      },
      { onConflict: "automation_id,trigger_source,trigger_ref_id", ignoreDuplicates: true }
    )
    .select()
    .maybeSingle();
  if (error) throw new Error(`Falha ao criar run: ${error.message}`);
  return data; // null = já existe run desta automação para este comentário
}
