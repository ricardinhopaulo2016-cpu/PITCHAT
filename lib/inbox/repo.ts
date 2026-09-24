import type { SupabaseClient } from "@supabase/supabase-js";

const LIST_LIMIT = 50; // teto de conversas carregadas por vez — nunca "select * sem limite"
const ACTIVITY_LIMIT = 300; // teto pras queries de "última atividade" (messages/comments), bounded independente do nº de conversas

export type ConversationListItem = {
  id: string;
  contactId: string;
  contactUsername: string | null;
  socialAccountUsername: string | null;
  automationEnabled: boolean;
  unread: boolean;
  previewText: string | null;
  previewAt: string | null;
};

/**
 * Lista conversas do workspace com preview da última atividade — 3 queries
 * fixas (conversas, messages recentes, comments recentes), nunca N+1 por
 * conversa. "Última mensagem" pode vir de `messages` (automação/manual) ou
 * de `comments` (quando a conversa só tem o comentário que a originou, sem
 * nenhuma automação ainda ter respondido) — pega o que for mais recente
 * entre os dois, nunca inventa uma prévia genérica.
 */
export async function listConversations(admin: SupabaseClient, workspaceId: string): Promise<ConversationListItem[]> {
  const { data: conversations } = await admin
    .from("conversations")
    .select(
      "id, contact_id, automation_enabled, last_message_at, last_read_at, contact:contacts(username), social_account:social_accounts(username)"
    )
    .eq("workspace_id", workspaceId)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(LIST_LIMIT);

  if (!conversations || conversations.length === 0) return [];

  const conversationIds = conversations.map((c) => c.id as string);
  const contactIds = conversations.map((c) => c.contact_id as string);

  const [{ data: recentMessages }, { data: recentComments }] = await Promise.all([
    admin
      .from("messages")
      .select("conversation_id, text, direction, created_at")
      .in("conversation_id", conversationIds)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
    admin
      .from("comments")
      .select("contact_id, text, created_at")
      .in("contact_id", contactIds)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
  ]);

  const latestMessageByConversation = new Map<string, { text: string | null; at: string }>();
  for (const m of recentMessages ?? []) {
    if (!latestMessageByConversation.has(m.conversation_id as string)) {
      latestMessageByConversation.set(m.conversation_id as string, { text: m.text as string | null, at: m.created_at as string });
    }
  }
  const latestCommentByContact = new Map<string, { text: string | null; at: string }>();
  for (const c of recentComments ?? []) {
    if (!latestCommentByContact.has(c.contact_id as string)) {
      latestCommentByContact.set(c.contact_id as string, { text: c.text as string | null, at: c.created_at as string });
    }
  }

  return conversations.map((c) => {
    const msg = latestMessageByConversation.get(c.id as string);
    const comment = latestCommentByContact.get(c.contact_id as string);
    const useMsg = msg && (!comment || msg.at > comment.at);
    const preview = useMsg ? msg : comment;

    const lastMessageAt = c.last_message_at as string | null;
    const lastReadAt = c.last_read_at as string | null;

    return {
      id: c.id as string,
      contactId: c.contact_id as string,
      contactUsername: (c.contact as unknown as { username: string | null } | null)?.username ?? null,
      socialAccountUsername: (c.social_account as unknown as { username: string | null } | null)?.username ?? null,
      automationEnabled: c.automation_enabled !== false,
      unread: !!lastMessageAt && (!lastReadAt || lastMessageAt > lastReadAt),
      previewText: preview?.text ?? (comment ? "Comentário recebido" : null),
      previewAt: preview?.at ?? lastMessageAt,
    };
  });
}


export type ConversationRow = {
  id: string;
  workspace_id: string;
  social_account_id: string;
  contact_id: string;
  status: string;
  automation_enabled: boolean;
};

export type TimelineEntry = {
  id: string;
  at: string;
  actor: "USER" | "AUTOMATION" | "HUMAN";
  text: string | null;
  /** Só presente em entradas de comentário (kind=comment) — PK interna de `comments`, usada por "Responder" (POST /api/comments/[id]/reply). Nunca o external_comment_id da Meta. */
  commentId?: string;
};

export type AutomationRunSummary = {
  id: string;
  automationName: string | null;
  status: string;
  waitingReason: string | null;
  lastError: string | null;
  startedAt: string;
};

/**
 * Monta a timeline real de uma conversa combinando 3 fontes (nunca uma
 * tabela nova só pra "unificar" — os dados já existem espalhados):
 * `comments` (o que o usuário comentou), `automation_run_steps` do tipo
 * PUBLIC_REPLY (resposta pública — não é DM, não fica em `messages` por
 * design) e `messages` (toda DM real: automação, clique, manual).
 */
export async function loadConversationTimeline(
  admin: SupabaseClient,
  params: { conversationId: string; contactId: string; socialAccountId: string }
): Promise<{ timeline: TimelineEntry[]; automationRuns: AutomationRunSummary[] }> {
  const [{ data: comments }, { data: messages }, { data: runs }] = await Promise.all([
    admin
      .from("comments")
      .select("id, text, created_at")
      .eq("social_account_id", params.socialAccountId)
      .eq("contact_id", params.contactId)
      .order("created_at", { ascending: true })
      .limit(ACTIVITY_LIMIT),
    admin
      .from("messages")
      .select("id, text, direction, origin, created_at, sent_at, received_at")
      .eq("conversation_id", params.conversationId)
      .order("created_at", { ascending: true })
      .limit(ACTIVITY_LIMIT),
    admin
      .from("automation_runs")
      .select("id, status, waiting_reason, started_at, automation:automations(name)")
      .eq("conversation_id", params.conversationId)
      .order("started_at", { ascending: true })
      .limit(50),
  ]);

  const runIds = (runs ?? []).map((r) => r.id as string);
  const { data: publicReplySteps } =
    runIds.length > 0
      ? await admin
          .from("automation_run_steps")
          .select("id, automation_run_id, output, started_at, status, error")
          .in("automation_run_id", runIds)
          .eq("node_type", "PUBLIC_REPLY")
          .limit(ACTIVITY_LIMIT)
      : { data: [] as Record<string, unknown>[] };

  const timeline: TimelineEntry[] = [];

  for (const c of comments ?? []) {
    timeline.push({
      id: `comment-${c.id}`,
      at: c.created_at as string,
      actor: "USER",
      text: c.text as string | null,
      commentId: c.id as string,
    });
  }

  for (const s of publicReplySteps ?? []) {
    if (s.status !== "succeeded") continue;
    const output = s.output as { text?: string } | null;
    timeline.push({ id: `step-${s.id}`, at: s.started_at as string, actor: "AUTOMATION", text: output?.text ?? null });
  }

  for (const m of messages ?? []) {
    const actor: TimelineEntry["actor"] = m.direction === "inbound" ? "USER" : m.origin === "manual" ? "HUMAN" : "AUTOMATION";
    timeline.push({
      id: `msg-${m.id}`,
      at: (m.sent_at ?? m.received_at ?? m.created_at) as string,
      actor,
      text: m.text as string | null,
    });
  }

  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  // Erro real de um step failed do mesmo run — mostrado recolhido na UI
  // (observabilidade secundária, nunca em destaque na timeline principal).
  const failedErrorByRun = new Map<string, string>();
  for (const s of publicReplySteps ?? []) {
    if (s.status === "failed" && s.error && !failedErrorByRun.has(s.automation_run_id as string)) {
      failedErrorByRun.set(s.automation_run_id as string, ((s.error as { message?: string }).message ?? "erro desconhecido"));
    }
  }

  const automationRuns: AutomationRunSummary[] = (runs ?? []).map((r) => ({
    id: r.id as string,
    automationName: (r.automation as unknown as { name: string } | null)?.name ?? null,
    status: r.status as string,
    waitingReason: r.waiting_reason as string | null,
    lastError: failedErrorByRun.get(r.id as string) ?? null,
    startedAt: r.started_at as string,
  }));

  return { timeline, automationRuns };
}

/** Conversa pertence ao workspace? Nunca confiar em conversationId vindo do client sem validar (docs/PITCHAT_ARCHITECTURE.md §4). */
export async function loadConversationForWorkspace(
  admin: SupabaseClient,
  conversationId: string,
  workspaceId: string
): Promise<ConversationRow | null> {
  const { data } = await admin
    .from("conversations")
    .select("id, workspace_id, social_account_id, contact_id, status, automation_enabled")
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data as ConversationRow | null;
}
