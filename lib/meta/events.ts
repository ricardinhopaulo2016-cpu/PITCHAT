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
  fromUserId: string;
  /** O payload que A GENTE definiu ao mandar o quick reply — nunca o título do botão. */
  payload: string;
  timestamp: string;
};

export type NormalizedEvent =
  | InstagramCommentReceived
  | InstagramMessageReceived
  | InstagramQuickReplyReceived;

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
  postback?: { payload?: string };
};

// O `value` de um change pode ser um comentário ou um evento de mensagem —
// a Meta não documenta um envelope único com exemplo literal pros dois, então
// aceitamos ambos os formatos de campo no mesmo tipo (ver aviso no topo do arquivo).
type RawChangeValue = RawCommentValue & RawMessagingEvent;

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
  fallbackTimestamp: string
): InstagramMessageReceived | InstagramQuickReplyReceived | null {
  const fromUserId = msg.sender?.id;
  if (!fromUserId) return null;
  const timestamp = msg.timestamp ? new Date(msg.timestamp).toISOString() : fallbackTimestamp;

  const quickReplyPayload = msg.message?.quick_reply?.payload ?? msg.postback?.payload;
  if (quickReplyPayload) {
    return {
      type: "InstagramQuickReplyReceived",
      externalAccountId,
      fromUserId,
      payload: quickReplyPayload,
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

const MESSAGING_FIELDS = new Set(["messages", "messaging_postbacks"]);

/**
 * Classifica o payload bruto pra gravar em `webhook_events.event_type`
 * (só rótulo pra debug/triagem — o processamento de verdade usa
 * `normalizeMetaWebhookPayload`, que já olha todos os entries/changes).
 * Precisa considerar TODOS os entries/changes, não só o primeiro — um único
 * payload pode carregar vários de uma vez.
 */
export function classifyWebhookEventType(
  payload: RawMetaWebhookPayload
): "comments" | "messages" | "messaging_postbacks" | "mixed" | "unknown" {
  const fieldsSeen = new Set<string>();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) fieldsSeen.add(change.field);
    if (entry.field) fieldsSeen.add(entry.field);
    if ((entry.messaging?.length ?? 0) > 0) fieldsSeen.add("messages"); // formato legado, ver aviso no topo
  }

  if (fieldsSeen.size === 0) return "unknown";
  if (fieldsSeen.size > 1) return "mixed";

  const [only] = fieldsSeen;
  if (only === "comments" || only === "messages" || only === "messaging_postbacks") return only;
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
      if (change.field === "comments") {
        const event = commentValueToEvent(change.value, externalAccountId, entryTimestamp);
        if (event) events.push(event);
      } else if (MESSAGING_FIELDS.has(change.field)) {
        const event = messagingValueToEvent(change.value, externalAccountId, entryTimestamp);
        if (event) events.push(event);
      }
    }

    // Formato alternativo (visto na doc de comment-moderation): field/value
    // direto no entry, sem `changes[]`. Ver aviso no topo do arquivo.
    if (entry.field && entry.value) {
      if (entry.field === "comments") {
        const event = commentValueToEvent(entry.value, externalAccountId, entryTimestamp);
        if (event) events.push(event);
      } else if (MESSAGING_FIELDS.has(entry.field)) {
        const event = messagingValueToEvent(entry.value, externalAccountId, entryTimestamp);
        if (event) events.push(event);
      }
    }

    // Formato legado do Messenger/Facebook Page — mantido por precaução
    // (ver aviso no topo do arquivo), sem confirmação de que a Meta ainda
    // usa isso pro produto Instagram API with Instagram Login.
    for (const msg of entry.messaging ?? []) {
      const event = messagingValueToEvent(msg, externalAccountId, entryTimestamp);
      if (event) events.push(event);
    }
  }

  return events;
}
