import type { SupabaseClient } from "@supabase/supabase-js";

const LIST_LIMIT = 50; // teto de conversas carregadas por vez — nunca "select * sem limite"
const ACTIVITY_LIMIT = 300; // teto pras queries de "última atividade" (messages/comments), bounded independente do nº de conversas

export type ConversationListItem = {
  id: string;
  contactId: string;
  contactUsername: string | null;
  /** `contacts.avatar_url` — null hoje pra todo mundo (nenhuma rotina de enrichment existe); a UI cai pra iniciais. */
  contactAvatarUrl: string | null;
  platform: string;
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
      "id, contact_id, automation_enabled, last_message_at, last_read_at, contact:contacts(username, avatar_url, platform), social_account:social_accounts(username)"
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
    const contact = c.contact as unknown as { username: string | null; avatar_url: string | null; platform: string | null } | null;

    return {
      id: c.id as string,
      contactId: c.contact_id as string,
      contactUsername: contact?.username ?? null,
      contactAvatarUrl: contact?.avatar_url ?? null,
      platform: contact?.platform ?? "instagram",
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
  /** Conta Instagram que recebeu a conversa (`social_accounts.username`). */
  socialAccountUsername: string | null;
};

/**
 * Marcador de sinal de uma linha de engine na timeline — segue a semântica
 * de components/icons/pitchat/signal-marker.tsx: ◆ lógica, ‖ espera, ■ fim,
 * ! incidente. Ações normais (mensagens) nunca ganham marker de engine.
 */
export type TimelineSignal = {
  marker: "logic" | "wait" | "end" | "error";
  label: string;
  detail: string | null;
};

export type TimelineEntry = {
  id: string;
  at: string;
  actor: "USER" | "AUTOMATION" | "HUMAN";
  text: string | null;
  /** Só presente em entradas de comentário (kind=comment) — PK interna de `comments`, usada por "Responder" (POST /api/comments/[id]/reply). Nunca o external_comment_id da Meta. */
  commentId?: string;
  /**
   * "comment" (veio de `comments`, ou é a resposta pública da automação),
   * "dm" (veio de `messages`) ou "engine" (sinal compacto de
   * `automation_run_steps`, ver `signal`) — só contexto visual, nunca lógica.
   */
  channel: "comment" | "dm" | "engine";
  /**
   * `comments.external_media_id` (o post da Meta onde o comentário
   * aconteceu) — achado real 24/09/2026: o mesmo contato pode comentar a
   * mesma frase em posts diferentes, e como a timeline agrega por
   * contact_id (não por media), as duas entradas pareciam duplicata sem
   * esse contexto. Não temos permalink/thumbnail de post persistido em
   * lugar nenhum do schema hoje — mostrar isso exigiria infra nova (não é
   * o pedido desta rodada), então por ora é só o ID truncado.
   */
  externalMediaId?: string | null;
  /** `messages.type` (text | quick_reply | button | …) — só em entradas de DM; distingue clique de quick reply de texto livre. */
  messageType?: string;
  /** Opções de um quick reply enviado (`messages.payload.options`). */
  options?: string[];
  /** Botão de um Button Template enviado (`messages.payload.button`). */
  button?: { title: string; url: string };
  /** Só em `channel: "engine"`. */
  signal?: TimelineSignal;
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
 * Tipos de step que aparecem como entrada própria na timeline. PUBLIC_REPLY
 * porque não mora em `messages`; KEYWORD_MATCH/CONDITION/DELAY/END porque
 * são decisões/pausas que não deixam rastro em nenhuma outra tabela.
 * SEND_MESSAGE/PRIVATE_REPLY/QUICK_REPLY ficam DE FORA de propósito — já
 * existem em `messages`, mostrar de novo duplicaria a mesma informação.
 * ADD_TAG/REMOVE_TAG/SET_CUSTOM_FIELD/HTTP_REQUEST/RANDOM_SPLIT ficam só na
 * observabilidade técnica.
 */
const TIMELINE_STEP_TYPES = ["PUBLIC_REPLY", "KEYWORD_MATCH", "CONDITION", "DELAY", "END"];

const NODE_LABEL: Record<string, string> = {
  PUBLIC_REPLY: "Resposta pública",
  PRIVATE_REPLY: "Resposta privada",
  SEND_MESSAGE: "Envio de mensagem",
  QUICK_REPLY: "Quick reply",
  KEYWORD_MATCH: "Keyword match",
  CONDITION: "Condição",
  DELAY: "Espera",
  END: "Fim do fluxo",
  ADD_TAG: "Adicionar tag",
  REMOVE_TAG: "Remover tag",
  SET_CUSTOM_FIELD: "Campo customizado",
  HTTP_REQUEST: "Requisição HTTP",
  RANDOM_SPLIT: "Split aleatório",
};

export type RunStepRow = {
  id: string;
  automation_run_id: string;
  node_type: string;
  status: string;
  input: unknown;
  output: unknown;
  error: unknown;
  attempt: number | null;
  started_at: string;
};

type CommentRow = { id: string; text: string | null; created_at: string; external_media_id: string | null };
type MessageRow = {
  id: string;
  text: string | null;
  direction: string;
  origin: string | null;
  type?: string | null;
  payload?: unknown;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
};

function stepToEntry(s: RunStepRow): TimelineEntry | null {
  const base = { id: `step-${s.id}`, at: s.started_at, actor: "AUTOMATION" as const, text: null };

  if (s.status === "failed") {
    const message = (s.error as { message?: string } | null)?.message ?? "erro desconhecido";
    const attempt = s.attempt && s.attempt > 1 ? ` · tentativa ${s.attempt}` : "";
    return {
      ...base,
      channel: "engine",
      signal: { marker: "error", label: `Falha · ${NODE_LABEL[s.node_type] ?? s.node_type}${attempt}`, detail: message },
    };
  }
  if (s.status !== "succeeded") return null;

  switch (s.node_type) {
    case "PUBLIC_REPLY":
      return { ...base, channel: "comment", text: (s.output as { text?: string } | null)?.text ?? null };
    case "KEYWORD_MATCH": {
      const matched = (s.output as { matched?: boolean } | null)?.matched !== false;
      const trigger = typeof s.input === "string" && s.input.length > 0 ? `“${s.input}”` : null;
      return {
        ...base,
        channel: "engine",
        signal: { marker: "logic", label: matched ? "Keyword match" : "Sem correspondência de keyword", detail: trigger },
      };
    }
    case "CONDITION": {
      const branch = (s.output as { branch?: string } | null)?.branch;
      return { ...base, channel: "engine", signal: { marker: "logic", label: "Condição", detail: branch ? `→ ${branch}` : null } };
    }
    case "DELAY": {
      const minutes = (s.input as { minutes?: number } | null)?.minutes;
      return {
        ...base,
        channel: "engine",
        signal: { marker: "wait", label: minutes ? `Espera · ${minutes} min` : "Espera", detail: null },
      };
    }
    case "END":
      return { ...base, channel: "engine", signal: { marker: "end", label: "Fluxo concluído", detail: null } };
    default:
      return null; // qualquer outro tipo não vira entrada — ver TIMELINE_STEP_TYPES
  }
}

/**
 * Composição pura da timeline (sem I/O — testável direto): comentários,
 * mensagens e steps de engine, ordenados cronologicamente. Empate de
 * timestamp mantém a ordem de inserção (comentário → step de engine →
 * mensagem), que reflete a ordem real em que o motor grava.
 */
export function composeTimeline(input: { comments: CommentRow[]; messages: MessageRow[]; steps: RunStepRow[] }): TimelineEntry[] {
  const timeline: TimelineEntry[] = [];

  for (const c of input.comments) {
    timeline.push({
      id: `comment-${c.id}`,
      at: c.created_at,
      actor: "USER",
      text: c.text,
      commentId: c.id,
      channel: "comment",
      externalMediaId: c.external_media_id ?? null,
    });
  }

  const steps = [...input.steps].sort((a, b) => new Date(a.started_at).getTime() - new Date(b.started_at).getTime());
  for (const s of steps) {
    const entry = stepToEntry(s);
    if (entry) timeline.push(entry);
  }

  for (const m of input.messages) {
    const actor: TimelineEntry["actor"] = m.direction === "inbound" ? "USER" : m.origin === "manual" ? "HUMAN" : "AUTOMATION";
    const payload = (m.payload ?? {}) as { options?: { title?: string }[]; button?: { title?: string; url?: string } };
    const options = (payload.options ?? []).map((o) => o.title).filter((t): t is string => !!t);
    timeline.push({
      id: `msg-${m.id}`,
      at: m.sent_at ?? m.received_at ?? m.created_at,
      actor,
      text: m.text,
      channel: "dm",
      ...(m.type ? { messageType: m.type } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(payload.button?.title && payload.button.url ? { button: { title: payload.button.title, url: payload.button.url } } : {}),
    });
  }

  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return timeline;
}

/**
 * Monta a timeline real de uma conversa combinando 3 fontes (nunca uma
 * tabela nova só pra "unificar" — os dados já existem espalhados):
 * `comments` (o que o usuário comentou), `automation_run_steps` (resposta
 * pública + sinais compactos do engine, ver TIMELINE_STEP_TYPES) e
 * `messages` (toda DM real: automação, clique, manual). Queries fixas e
 * bounded — 3 em paralelo + 2 em paralelo dos steps, nunca N+1.
 */
export async function loadConversationTimeline(
  admin: SupabaseClient,
  params: { conversationId: string; contactId: string; socialAccountId: string }
): Promise<{ timeline: TimelineEntry[]; automationRuns: AutomationRunSummary[] }> {
  const [{ data: comments }, { data: messages }, { data: runs }] = await Promise.all([
    admin
      .from("comments")
      .select("id, text, created_at, external_media_id")
      .eq("social_account_id", params.socialAccountId)
      .eq("contact_id", params.contactId)
      .order("created_at", { ascending: true })
      .limit(ACTIVITY_LIMIT),
    admin
      .from("messages")
      .select("id, text, direction, origin, type, payload, created_at, sent_at, received_at")
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
  const stepColumns = "id, automation_run_id, node_type, status, input, output, error, attempt, started_at";

  // Duas queries bounded em paralelo: os tipos que viram entrada na timeline
  // + QUALQUER step que falhou (falha nunca pode ficar invisível, seja qual
  // for o node). Mais recentes primeiro pra o teto nunca cortar o fim da
  // conversa; composeTimeline reordena cronologicamente.
  const [{ data: timelineSteps }, { data: failedSteps }] =
    runIds.length > 0
      ? await Promise.all([
          admin
            .from("automation_run_steps")
            .select(stepColumns)
            .in("automation_run_id", runIds)
            .in("node_type", TIMELINE_STEP_TYPES)
            .order("started_at", { ascending: false })
            .limit(ACTIVITY_LIMIT),
          admin
            .from("automation_run_steps")
            .select(stepColumns)
            .in("automation_run_id", runIds)
            .eq("status", "failed")
            .order("started_at", { ascending: false })
            .limit(ACTIVITY_LIMIT),
        ])
      : [{ data: [] as Record<string, unknown>[] }, { data: [] as Record<string, unknown>[] }];

  const stepsById = new Map<string, RunStepRow>();
  for (const s of [...(timelineSteps ?? []), ...(failedSteps ?? [])]) {
    stepsById.set(s.id as string, s as unknown as RunStepRow);
  }
  const steps = [...stepsById.values()];

  const timeline = composeTimeline({
    comments: (comments ?? []) as unknown as CommentRow[],
    messages: (messages ?? []) as unknown as MessageRow[],
    steps,
  });

  // Erro real de um step failed do mesmo run — observabilidade secundária
  // (painel de contexto), nunca em destaque na timeline principal.
  const failedErrorByRun = new Map<string, string>();
  for (const s of steps) {
    if (s.status === "failed" && s.error && !failedErrorByRun.has(s.automation_run_id)) {
      failedErrorByRun.set(s.automation_run_id, (s.error as { message?: string }).message ?? "erro desconhecido");
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
    .select("id, workspace_id, social_account_id, contact_id, status, automation_enabled, social_account:social_accounts(username)")
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!data) return null;
  const { social_account, ...row } = data as unknown as Omit<ConversationRow, "socialAccountUsername"> & {
    social_account: { username: string | null } | null;
  };
  return { ...row, socialAccountUsername: social_account?.username ?? null };
}
