import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliveryState } from "@/lib/ui/format";

export const CONVERSATIONS_PAGE_SIZE = 50; // teto de conversas carregadas por vez — nunca "select * sem limite"
const ACTIVITY_LIMIT = 300; // teto pras queries de "última atividade" (messages/comments), bounded independente do nº de conversas
const PREVIEW_ROUNDS = 3; // rodadas das queries de prévia: conversa muito movimentada não pode esconder a prévia das outras da página

/**
 * Coluna que ainda não existe no banco: 42703 em select/filtro/order,
 * PGRST204 em update. Só acontece se o código for ao ar antes da migration
 * 20261109120000_inbox_unread_and_read_receipts: a tela continua funcionando,
 * sem contagem de não lidas e sem "Visualizada".
 */
function isMissingColumnError(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}

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
  /** Quantas mensagens a pessoa mandou desde a última vez que a conversa foi aberta. */
  unreadCount: number;
  previewText: string | null;
  previewAt: string | null;
};

type Preview = { text: string | null; at: string };

const CONVERSATION_COLUMNS =
  "id, contact_id, social_account_id, automation_enabled, last_message_at, contact:contacts(username, avatar_url, platform), social_account:social_accounts(username)";

type ConversationQueryOptions = { socialAccountId?: string | null; unreadOnly: boolean; from: number; to: number };

/**
 * Filtros de canal e de não lidas SEMPRE na query, antes do corte da página:
 * filtrar depois em JS esconderia conversas reais que não estivessem entre as
 * mais recentes. `id` no fim deixa a ordem estável entre páginas.
 */
async function fetchConversationRows(
  admin: SupabaseClient,
  workspaceId: string,
  opts: ConversationQueryOptions
): Promise<Record<string, unknown>[]> {
  const scoped = (columns: string) => {
    const query = admin.from("conversations").select(columns).eq("workspace_id", workspaceId);
    return opts.socialAccountId ? query.eq("social_account_id", opts.socialAccountId) : query;
  };

  let query = scoped(`${CONVERSATION_COLUMNS}, last_inbound_at, unread_inbound_count`);
  if (opts.unreadOnly) query = query.gt("unread_inbound_count", 0);
  const { data, error } = await query
    .order("last_inbound_at", { ascending: false, nullsFirst: false })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .range(opts.from, opts.to);

  if (!error) return (data ?? []) as unknown as Record<string, unknown>[];
  if (!isMissingColumnError(error)) {
    console.error("[inbox] falha ao listar conversas:", error.message);
    return [];
  }
  if (opts.unreadOnly) return [];

  const { data: legacy } = await scoped(CONVERSATION_COLUMNS)
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: true })
    .range(opts.from, opts.to);
  return (legacy ?? []) as unknown as Record<string, unknown>[];
}

/**
 * Última linha por chave, em poucas rodadas fixas (nunca uma query por
 * conversa). Cada rodada traz as linhas mais recentes das chaves que ainda
 * faltam, então uma conversa muito movimentada não apaga a prévia das outras.
 * `queryIdByKey` diz qual id buscar para cada chave da prévia.
 */
async function loadLatestPreviews(
  queryIdByKey: Map<string, string>,
  fetchRows: (ids: string[]) => PromiseLike<{ data: unknown[] | null }>,
  keyOf: (row: Record<string, unknown>) => string
): Promise<Map<string, Preview>> {
  const latest = new Map<string, Preview>();

  for (let round = 0; round < PREVIEW_ROUNDS; round++) {
    const pendingIds = [...queryIdByKey].filter(([key]) => !latest.has(key)).map(([, id]) => id);
    if (pendingIds.length === 0) break;

    const { data } = await fetchRows([...new Set(pendingIds)]);
    const rows = (data ?? []) as Record<string, unknown>[];
    for (const row of rows) {
      const key = keyOf(row);
      if (queryIdByKey.has(key) && !latest.has(key)) latest.set(key, { text: row.text as string | null, at: row.created_at as string });
    }
    if (rows.length < ACTIVITY_LIMIT) break; // veio tudo: quem faltou não tem linha nenhuma
  }
  return latest;
}

/**
 * Lista uma página de conversas do workspace com preview da última atividade.
 * Número fixo de queries por página (conversas + rodadas limitadas de prévia),
 * nunca N+1 por conversa. "Última mensagem" pode vir de `messages`
 * (automação/manual) ou de `comments` (quando a conversa só tem o comentário
 * que a originou) — pega o que for mais recente entre os dois, nunca inventa
 * uma prévia genérica.
 *
 * Ordem: última entrada da pessoa; conversas sem entrada depois, por
 * last_message_at. Mensagem enviada não reordena quem tem entrada.
 */
export async function listConversations(
  admin: SupabaseClient,
  workspaceId: string,
  opts: { socialAccountId?: string | null; unreadOnly?: boolean; page?: number } = {}
): Promise<{ conversations: ConversationListItem[]; hasMore: boolean }> {
  const page = Math.max(1, opts.page ?? 1);
  const from = (page - 1) * CONVERSATIONS_PAGE_SIZE;
  // Uma linha a mais só pra saber se existe próxima página, sem contar a tabela.
  const rows = await fetchConversationRows(admin, workspaceId, {
    socialAccountId: opts.socialAccountId,
    unreadOnly: opts.unreadOnly ?? false,
    from,
    to: from + CONVERSATIONS_PAGE_SIZE,
  });

  const hasMore = rows.length > CONVERSATIONS_PAGE_SIZE;
  const conversations = rows.slice(0, CONVERSATIONS_PAGE_SIZE);
  if (conversations.length === 0) return { conversations: [], hasMore: false };

  // O mesmo contato pode comentar em duas contas, e cada uma é uma conversa.
  const accountContactKey = (socialAccountId: unknown, contactId: unknown) => `${socialAccountId}:${contactId}`;
  const accountIds = [...new Set(conversations.map((c) => c.social_account_id as string))];

  const [latestMessageByConversation, latestCommentByAccountContact] = await Promise.all([
    loadLatestPreviews(
      new Map(conversations.map((c) => [c.id as string, c.id as string])),
      (ids) =>
        admin
          .from("messages")
          .select("conversation_id, text, direction, created_at")
          .in("conversation_id", ids)
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
      (row) => row.conversation_id as string
    ),
    loadLatestPreviews(
      new Map(conversations.map((c) => [accountContactKey(c.social_account_id, c.contact_id), c.contact_id as string])),
      (ids) =>
        admin
          .from("comments")
          .select("social_account_id, contact_id, text, created_at")
          .in("social_account_id", accountIds)
          .in("contact_id", ids)
          .order("created_at", { ascending: false })
          .limit(ACTIVITY_LIMIT),
      (row) => accountContactKey(row.social_account_id, row.contact_id)
    ),
  ]);

  return {
    hasMore,
    conversations: conversations.map((c) => {
      const msg = latestMessageByConversation.get(c.id as string);
      const comment = latestCommentByAccountContact.get(accountContactKey(c.social_account_id, c.contact_id));
      const useMsg = msg && (!comment || msg.at > comment.at);
      const preview = useMsg ? msg : comment;
      // DM só com anexo é gravada com text null: nunca mostrar como comentário.
      const previewFallback = useMsg ? "Mensagem sem texto" : comment ? "Comentário recebido" : null;

      const lastMessageAt = c.last_message_at as string | null;
      const unreadCount = (c.unread_inbound_count as number | null | undefined) ?? 0;
      const contact = c.contact as unknown as { username: string | null; avatar_url: string | null; platform: string | null } | null;

      return {
        id: c.id as string,
        contactId: c.contact_id as string,
        contactUsername: contact?.username ?? null,
        contactAvatarUrl: contact?.avatar_url ?? null,
        platform: contact?.platform ?? "instagram",
        socialAccountUsername: (c.social_account as unknown as { username: string | null } | null)?.username ?? null,
        automationEnabled: c.automation_enabled !== false,
        unread: unreadCount > 0,
        unreadCount,
        previewText: preview?.text ?? previewFallback,
        previewAt: preview?.at ?? lastMessageAt,
      };
    }),
  };
}

/** Conversas com não lidas no workspace (e no canal, se houver). Sem a coluna ainda, devolve 0. */
export async function countUnreadConversations(
  admin: SupabaseClient,
  workspaceId: string,
  opts: { socialAccountId?: string | null } = {}
): Promise<number> {
  let query = admin
    .from("conversations")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);
  if (opts.socialAccountId) query = query.eq("social_account_id", opts.socialAccountId);
  const { count, error } = await query.gt("unread_inbound_count", 0);
  if (error) {
    if (!isMissingColumnError(error)) console.error("[inbox] falha ao contar não lidas:", error.message);
    return 0;
  }
  return count ?? 0;
}

/**
 * Abrir a conversa zera as não lidas. Validar o workspace aqui é obrigatório:
 * o client é service_role e o id vem da URL.
 */
export async function markConversationRead(admin: SupabaseClient, conversationId: string, workspaceId: string): Promise<void> {
  const lastReadAt = new Date().toISOString();
  const update = (patch: Record<string, unknown>) =>
    admin.from("conversations").update(patch).eq("id", conversationId).eq("workspace_id", workspaceId);

  // Só grava se havia não lida: cada gravação vira evento em tempo real, e a
  // tela aberta recarregaria e gravaria de novo, sem parar.
  const { error } = await update({ last_read_at: lastReadAt, unread_inbound_count: 0 }).gt("unread_inbound_count", 0);
  if (!error) return;
  if (isMissingColumnError(error)) await update({ last_read_at: lastReadAt });
  else console.error("[inbox] falha ao marcar conversa como lida:", error.message);
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
  /** Só em DM enviada (automação ou humano). Comentário e resposta pública não têm. */
  delivery?: DeliveryState;
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
  status?: string | null;
  read_at?: string | null;
  created_at: string;
  sent_at: string | null;
  received_at: string | null;
};

/** Sem confirmação da Meta a DM é só "enviada": nunca afirma que a pessoa não viu. */
function deliveryOf(m: MessageRow): DeliveryState | undefined {
  if (m.direction !== "outbound") return undefined;
  if (m.status === "failed") return { state: "failed" };
  if (m.status !== "sent" && m.status !== "delivered") return undefined;
  return m.read_at ? { state: "seen", at: m.read_at } : { state: "sent" };
}

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
    const delivery = deliveryOf(m);
    timeline.push({
      id: `msg-${m.id}`,
      at: m.sent_at ?? m.received_at ?? m.created_at,
      actor,
      text: m.text,
      channel: "dm",
      ...(m.type ? { messageType: m.type } : {}),
      ...(options.length > 0 ? { options } : {}),
      ...(payload.button?.title && payload.button.url ? { button: { title: payload.button.title, url: payload.button.url } } : {}),
      ...(delivery ? { delivery } : {}),
    });
  }

  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return timeline;
}

/**
 * Mensagens mais recentes da conversa em ordem cronológica: o teto corta o
 * começo da conversa, nunca o fim (o que a pessoa acabou de mandar).
 */
async function loadTimelineMessages(admin: SupabaseClient, conversationId: string): Promise<MessageRow[]> {
  const baseColumns = "id, text, direction, origin, type, payload, status, created_at, sent_at, received_at";
  const fetchWith = (columns: string) =>
    admin.from("messages").select(columns).eq("conversation_id", conversationId).order("created_at", { ascending: false }).limit(ACTIVITY_LIMIT);

  const { data, error } = await fetchWith(`${baseColumns}, read_at`);
  const rows = error && isMissingColumnError(error) ? (await fetchWith(baseColumns)).data : data;
  return ((rows ?? []) as unknown as MessageRow[]).reverse();
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
  const [{ data: comments }, messages, { data: runs }] = await Promise.all([
    admin
      .from("comments")
      .select("id, text, created_at, external_media_id")
      .eq("social_account_id", params.socialAccountId)
      .eq("contact_id", params.contactId)
      .order("created_at", { ascending: false })
      .limit(ACTIVITY_LIMIT),
    loadTimelineMessages(admin, params.conversationId),
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
    comments: ((comments ?? []) as unknown as CommentRow[]).reverse(),
    messages,
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
