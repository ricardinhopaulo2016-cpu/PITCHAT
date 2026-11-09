/**
 * Adapter layer: converte o payload bruto do webhook da Meta em eventos
 * internos normalizados. NINGUÉM fora deste arquivo (e do parser em
 * app/api/webhooks/meta/route.ts) deve olhar pro formato bruto da Meta —
 * o resto do sistema só conhece esses tipos normalizados.
 *
 * Formato baseado em docs/PITCHAT_META_INTEGRATION.md, com payloads JSON
 * literais confirmados via documentação oficial (não inventados).
 *
 * ATENÇÃO — nenhuma página oficial da Meta mostra um JSON de exemplo
 * completo e literal para os eventos de `messages`/`messaging_postbacks`/
 * `message_reactions` do Instagram (confirmado em 09/09/2026 via fetch
 * direto de docs/instagram-platform/webhooks e
 * docs/graph-api/webhooks/reference/instagram — ambas só documentam
 * `comments` com exemplo, ou um exemplo genérico de outro campo/objeto).
 * O único formato de envelope com exemplo literal confirmado é
 * `entry[].changes[].{field,value}` (visto tanto pra `comments` quanto
 * no exemplo genérico da doc de webhooks). Por isso o parser abaixo aceita,
 * para TODOS os campos (comments, messages, messaging_postbacks):
 *   1. `entry[].changes[].{field,value}` (formato com exemplo confirmado)
 *   2. `entry[].field` / `entry[].value` direto (visto na doc de
 *      comment-moderation, sem `changes[]`)
 *   3. `entry[].messaging[]` (formato clássico do Messenger/Facebook Page —
 *      mantido por precaução, mas não tem confirmação de que se aplica ao
 *      produto "Instagram API with Instagram Login")
 * Ajustar/simplificar assim que o primeiro webhook real chegar (bloqueio
 * real até existir Meta App + Instagram conectado — ver
 * docs/PITCHAT_META_INTEGRATION.md §3).
 */

export type InstagramCommentReceived = {
  type: "InstagramCommentReceived";
  externalAccountId: string; // IGSID da conta profissional que recebeu o comentário
  externalCommentId: string;
  externalMediaId: string | null;
  parentCommentId: string | null;
  fromUserId: string; // IGSID de quem comentou
  fromUsername: string | null;
  text: string;
  timestamp: string; // ISO
};

export type InstagramMessageReceived = {
  type: "InstagramMessageReceived";
  externalAccountId: string;
  externalMessageId: string | null;
  fromUserId: string;
  text: string | null;
  timestamp: string;
};

export type InstagramQuickReplyReceived = {
  type: "InstagramQuickReplyReceived";
  externalAccountId: string;
  /** `mid` da Meta ou, sem ele, chave derivada do próprio evento (ver quickReplyExternalId). Null só sem nenhum horário no evento. */
  externalMessageId: string | null;
  fromUserId: string;
  /** O payload que A GENTE definiu ao mandar o quick reply — nunca o título do botão. Único usado pra decidir o fluxo (ver lib/automation/engine.ts::parseQuickReplyPayload). */
  payload: string;
  /** Título do botão escolhido, só pra exibição no Inbox (docs/PITCHAT_META_INTEGRATION.md §5: "message.text = título escolhido") — nunca usar isso pra lógica. */
  buttonTitle: string | null;
  timestamp: string;
};

/**
 * A pessoa visualizou uma DM da conta. O formato vem da doc da Meta para
 * mensagens do Instagram (sender = quem leu, recipient = conta, read.mid), sem
 * exemplo oficial completo para Instagram Login: ver
 * docs/PITCHAT_META_INTEGRATION.md §3. Nunca vira mensagem nem retoma run.
 */
export type InstagramMessageSeen = {
  type: "InstagramMessageSeen";
  externalAccountId: string;
  /** IGSID de quem leu. */
  fromUserId: string;
  /** `read.mid`: a mensagem lida, quando a Meta informa. */
  externalMessageId: string | null;
  /** `read.watermark` em ISO: tudo até esse horário foi lido, quando a Meta informa. */
  watermarkAt: string | null;
  timestamp: string;
};

export type NormalizedEvent =
  | InstagramCommentReceived
  | InstagramMessageReceived
  | InstagramQuickReplyReceived
  | InstagramMessageSeen;

type RawCommentValue = {
  id?: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string };
  parent_id?: string;
};

type RawMessagingEvent = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; quick_reply?: { payload?: string } };
  postback?: { mid?: string; payload?: string; title?: string };
  read?: RawReadMarker;
};

type RawReadMarker = { mid?: unknown; watermark?: unknown };

// O `value` de um change pode ser um comentário, um evento de mensagem ou uma
// leitura — a Meta não documenta um envelope único com exemplo literal, então
// aceitamos todos os formatos de campo no mesmo tipo (ver aviso no topo do
// arquivo). `mid`/`watermark` soltos só valem com field messaging_seen.
type RawChangeValue = RawCommentValue & RawMessagingEvent & RawReadMarker;

type RawChange = {
  field: string;
  value: RawChangeValue;
};

type RawEntry = {
  id?: string; // IGSID da conta que recebeu o evento
  time?: number;
  changes?: RawChange[];
  messaging?: RawMessagingEvent[];
  // Formato alternativo (comment-moderation doc): field/value direto no entry.
  field?: string;
  value?: RawChangeValue;
};

export type RawMetaWebhookPayload = {
  object?: string;
  entry?: RawEntry[];
};

/**
 * Extrai todos os eventos normalizados de um payload de webhook — um único
 * payload pode carregar múltiplos entries/changes/messaging de uma vez.
 */
function commentValueToEvent(
  v: RawCommentValue,
  externalAccountId: string,
  timestamp: string
): InstagramCommentReceived | null {
  if (!v.id || !v.text) return null;
  return {
    type: "InstagramCommentReceived",
    externalAccountId,
    externalCommentId: v.id,
    externalMediaId: v.media?.id ?? null,
    parentCommentId: v.parent_id ?? null,
    fromUserId: v.from?.id ?? "",
    fromUsername: v.from?.username ?? null,
    text: v.text,
    timestamp,
  };
}

/**
 * Converte um evento de messaging (mensagem, postback ou quick reply) —
 * usado tanto para `entry.messaging[]` (formato clássico) quanto para
 * `entry.changes[]` com field `messages`/`messaging_postbacks` (formato
 * com envelope confirmado, ver aviso no topo do arquivo). Um evento sem
 * `sender.id` é ignorado (payload malformado), nunca lança exceção.
 */
function messagingValueToEvent(
  msg: RawMessagingEvent,
  externalAccountId: string,
  fallbackTimestamp: string,
  entryTime: number | undefined
): InstagramMessageReceived | InstagramQuickReplyReceived | InstagramMessageSeen | null {
  const fromUserId = msg.sender?.id;
  if (!fromUserId) return null;
  if (isReadEvent(msg)) return seenValueToEvent(msg, externalAccountId, fallbackTimestamp);
  const timestamp = msg.timestamp ? new Date(msg.timestamp).toISOString() : fallbackTimestamp;

  const quickReplyPayload = msg.message?.quick_reply?.payload ?? msg.postback?.payload;
  if (quickReplyPayload) {
    return {
      type: "InstagramQuickReplyReceived",
      externalAccountId,
      externalMessageId: quickReplyExternalId(msg, fromUserId, quickReplyPayload, entryTime),
      fromUserId,
      payload: quickReplyPayload,
      buttonTitle: msg.message?.text ?? msg.postback?.title ?? null,
      timestamp,
    };
  }

  if (msg.message) {
    return {
      type: "InstagramMessageReceived",
      externalAccountId,
      externalMessageId: msg.message.mid ?? null,
      fromUserId,
      text: msg.message.text ?? null,
      timestamp,
    };
  }

  return null;
}

/**
 * Chave estável do toque, para o reenvio do webhook não contar em dobro. A doc
 * do projeto (§3) não mostra `mid` em postback: lê se vier e, sem ele, deriva
 * só de campos do próprio evento. Reenvio repete a chave; tocar de novo no
 * mesmo botão tem outro horário e conta como outro toque. Sem horário nenhum
 * no evento não há chave estável, então devolve null em vez de inventar.
 */
function quickReplyExternalId(
  msg: RawMessagingEvent,
  fromUserId: string,
  payload: string,
  entryTime: number | undefined
): string | null {
  const mid = msg.message?.mid ?? msg.postback?.mid;
  if (mid) return mid;
  const occurredAt = msg.timestamp ?? entryTime;
  return occurredAt ? `postback:${fromUserId}:${occurredAt}:${payload}` : null;
}

/** Leitura só quando o evento não traz mensagem nem postback: nunca descarta uma mensagem real. */
function isReadEvent(msg: RawMessagingEvent): boolean {
  return !!msg.read && !msg.message && !msg.postback;
}

/**
 * Horário da Meta em ISO, ou null se não for um horário plausível. Aceita
 * milissegundos (13 dígitos) e segundos (10 dígitos), em número ou texto.
 */
function metaEpochToIso(value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n) || n < 1e9) return null;
  const date = new Date(n < 1e12 ? n * 1000 : n);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Sem quem leu, ou sem mid e watermark, não há o que registrar: ignora. */
function seenValueToEvent(
  value: RawMessagingEvent & RawReadMarker,
  externalAccountId: string,
  fallbackTimestamp: string
): InstagramMessageSeen | null {
  const fromUserId = value.sender?.id;
  if (!fromUserId) return null;

  const read = value.read ?? value;
  const externalMessageId = typeof read.mid === "string" && read.mid !== "" ? read.mid : null;
  const watermarkAt = metaEpochToIso(read.watermark);
  if (!externalMessageId && !watermarkAt) return null;

  return {
    type: "InstagramMessageSeen",
    externalAccountId: externalAccountId || value.recipient?.id || "",
    fromUserId,
    externalMessageId,
    watermarkAt,
    timestamp: metaEpochToIso(value.timestamp) ?? fallbackTimestamp,
  };
}

const MESSAGING_FIELDS = new Set(["messages", "messaging_postbacks"]);

/** Um par field/value, venha de `entry.changes[]` ou direto no entry. */
function fieldValueToEvent(
  field: string,
  value: RawChangeValue,
  externalAccountId: string,
  entryTimestamp: string,
  entryTime: number | undefined
): NormalizedEvent | null {
  if (field === "comments") return commentValueToEvent(value, externalAccountId, entryTimestamp);
  if (field === "messaging_seen") return seenValueToEvent(value, externalAccountId, entryTimestamp);
  if (MESSAGING_FIELDS.has(field)) return messagingValueToEvent(value, externalAccountId, entryTimestamp, entryTime);
  return null;
}

/**
 * Classifica o payload bruto pra gravar em `webhook_events.event_type`
 * (só rótulo pra debug/triagem — o processamento de verdade usa
 * `normalizeMetaWebhookPayload`, que já olha todos os entries/changes).
 * Precisa considerar TODOS os entries/changes, não só o primeiro — um único
 * payload pode carregar vários de uma vez.
 */
export function classifyWebhookEventType(
  payload: RawMetaWebhookPayload
): "comments" | "messages" | "messaging_postbacks" | "messaging_seen" | "mixed" | "unknown" {
  const fieldsSeen = new Set<string>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) fieldsSeen.add(change.field);
    if (entry.field) fieldsSeen.add(entry.field);
    // Formato legado, ver aviso no topo.
    for (const msg of entry.messaging ?? []) fieldsSeen.add(isReadEvent(msg) ? "messaging_seen" : "messages");
  }

  if (fieldsSeen.size === 0) return "unknown";
  if (fieldsSeen.size > 1) return "mixed";

  const [only] = fieldsSeen;
  if (only === "comments" || only === "messages" || only === "messaging_postbacks" || only === "messaging_seen") return only;
  return "unknown";
}

export function normalizeMetaWebhookPayload(payload: RawMetaWebhookPayload): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];

  for (const entry of payload.entry ?? []) {
    const externalAccountId = entry.id ?? "";
    const entryTimestamp = entry.time ? new Date(entry.time * 1000).toISOString() : new Date().toISOString();

    // Formato "clássico": field/value dentro de entry.changes[]. Cobre
    // comments, messages e messaging_postbacks — é o único formato com
    // exemplo literal confirmado na doc oficial (ver aviso no topo do arquivo).
    for (const change of entry.changes ?? []) {
      const event = fieldValueToEvent(change.field, change.value, externalAccountId, entryTimestamp, entry.time);
      if (event) events.push(event);
    }

    // Formato alternativo (visto na doc de comment-moderation): field/value
    // direto no entry, sem `changes[]`. Ver aviso no topo do arquivo.
    if (entry.field && entry.value) {
      const event = fieldValueToEvent(entry.field, entry.value, externalAccountId, entryTimestamp, entry.time);
      if (event) events.push(event);
    }

    // Formato legado do Messenger/Facebook Page — mantido por precaução
    // (ver aviso no topo do arquivo), sem confirmação de que a Meta ainda
    // usa isso pro produto Instagram API with Instagram Login.
    for (const msg of entry.messaging ?? []) {
      const event = messagingValueToEvent(msg, externalAccountId, entryTimestamp, entry.time);
      if (event) events.push(event);
    }
  }

  return events;
}
