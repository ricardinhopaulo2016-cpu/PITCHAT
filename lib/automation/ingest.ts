import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaClient } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/token-crypto";
import type { InstagramCommentReceived, InstagramQuickReplyReceived } from "@/lib/meta/events";
import { advanceRun, claimWaitingRun, parseQuickReplyPayload, type SocialAccountForEngine } from "./engine";
import type { Graph } from "./graph";
import type { ExecutionContext } from "./node-handlers";

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

  if (commentError) return { processed: false, reason: `DB_ERROR: ${commentError.message}` };
  if (!insertedComment) return { processed: false, reason: "DUPLICATE_COMMENT_IGNORED" };

  const conversation = await upsertConversation(admin, socialAccount.workspace_id, socialAccount.id, contact.id);

  const automations = await loadActiveAutomations(admin, socialAccount.profile_id);
  const socialAccountForEngine: SocialAccountForEngine = {
    id: socialAccount.id,
    externalAccountId: socialAccount.external_account_id,
    accessToken: decryptToken(socialAccount.access_token_encrypted),
  };

  for (const automation of automations) {
    const run = await createRun(admin, {
      workspaceId: socialAccount.workspace_id,
      automationId: automation.automationId,
      automationVersionId: automation.automationVersionId,
      conversationId: conversation.id,
      contactId: contact.id,
      triggerSource: "comment",
      triggerRefId: event.externalCommentId,
    });

    const ctx: ExecutionContext = {
      variables: {},
      triggerText: event.text,
      contactTags: [],
      customFields: {},
      conversationAutomationEnabled: conversation.automation_enabled,
    };

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

  const { data: automationRun } = await admin
    .from("automation_runs")
    .select("automation_version_id, contact_id")
    .eq("id", run.id)
    .single();

  const { data: version } = await admin
    .from("automation_versions")
    .select("graph")
    .eq("id", automationRun!.automation_version_id)
    .single();

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
    graph: version!.graph as Graph,
    socialAccount: socialAccountForEngine,
    recipientId: event.fromUserId,
    commentId: null,
    ctx,
    startNodeId: nextAfter(parsed.nodeId, version!.graph as Graph),
  });

  return { processed: true };
}

/** Acha o próximo node depois do QUICK_REPLY que pausou, seguindo a aresta certa. */
function nextAfter(quickReplyNodeId: string, graph: Graph): string {
  const edge = graph.edges.find((e) => e.from === quickReplyNodeId);
  return edge?.to ?? quickReplyNodeId;
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

async function loadActiveAutomations(admin: SupabaseClient, profileId: string) {
  const { data } = await admin
    .from("automations")
    .select("id, current_version_id, automation_versions!automations_current_version_fk(graph)")
    .eq("profile_id", profileId)
    .eq("status", "active")
    .not("current_version_id", "is", null);

  return (data ?? []).map((row: Record<string, unknown>) => ({
    automationId: row.id as string,
    automationVersionId: row.current_version_id as string,
    graph: (row.automation_versions as { graph: Graph }).graph,
  }));
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
  const { data } = await admin
    .from("automation_runs")
    .insert({
      workspace_id: params.workspaceId,
      automation_id: params.automationId,
      automation_version_id: params.automationVersionId,
      conversation_id: params.conversationId,
      contact_id: params.contactId,
      trigger_source: params.triggerSource,
      trigger_ref_id: params.triggerRefId,
      status: "running",
    })
    .select()
    .single();
  return data!;
}
