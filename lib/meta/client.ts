// Sem "server-only" de propósito — só funciona dentro do bundler do Next e
// quebra testes em Node puro (mesmo caso de lib/media/ffprobe.ts). Este
// cliente recebe o access token por parâmetro (nunca lê env global), então
// nem faz sentido protegê-lo contra import client-side por esse motivo.

/**
 * Cliente HTTP real da Instagram Graph API (Instagram API with Instagram
 * Login). Endpoints conforme docs/PITCHAT_META_INTEGRATION.md — ainda NÃO
 * testado contra a API real (bloqueado até existir Meta App + Instagram
 * conectado, ver checklist no doc). O restante do sistema depende só da
 * interface `MetaClient`, nunca chama fetch direto — troca de implementação
 * (ex: um FakeMetaClient em teste) não exige mexer em mais nada.
 */

export type MetaApiErrorKind = "RETRYABLE" | "NON_RETRYABLE";

export class MetaApiError extends Error {
  readonly kind: MetaApiErrorKind;
  readonly code?: number;
  readonly subcode?: number;
  readonly httpStatus?: number;

  constructor(
    message: string,
    opts: { kind: MetaApiErrorKind; code?: number; subcode?: number; httpStatus?: number }
  ) {
    super(message);
    this.name = "MetaApiError";
    this.kind = opts.kind;
    this.code = opts.code;
    this.subcode = opts.subcode;
    this.httpStatus = opts.httpStatus;
  }
}

export type SendMessageResult = { externalMessageId: string | null };

export interface MetaClient {
  /** Resposta pública a um comentário. POST /{comment-id}/replies */
  sendPublicReply(params: { accessToken: string; commentId: string; text: string }): Promise<void>;

  /**
   * Private reply — só funciona 1x por comentário, dentro de 7 dias.
   * POST /{ig-user-id}/messages, recipient.comment_id.
   */
  sendPrivateReply(params: {
    accessToken: string;
    igUserId: string;
    commentId: string;
    text: string;
  }): Promise<SendMessageResult>;

  /** Mensagem de texto simples. POST /{ig-user-id}/messages, recipient.id (IGSID). */
  sendTextMessage(params: {
    accessToken: string;
    igUserId: string;
    recipientId: string;
    text: string;
  }): Promise<SendMessageResult>;

  /** Mensagem com quick replies (máx 13 opções, título até 20 chars). */
  sendQuickReplies(params: {
    accessToken: string;
    igUserId: string;
    recipientId: string;
    text: string;
    options: { title: string; payload: string }[];
  }): Promise<SendMessageResult>;
}

// Códigos de rate limit confirmados na doc oficial (seção 11 de
// docs/PITCHAT_META_INTEGRATION.md) — sempre retryable, independente do
// status HTTP retornado junto.
const RATE_LIMIT_ERROR_CODES = new Set([4, 17, 32, 613]);
// 190 = OAuthException (token expirado/inválido/revogado) — nunca adianta
// tentar de novo sem reautenticar.
const AUTH_ERROR_CODE = 190;

export function classifyMetaError(httpStatus: number, errorCode?: number): MetaApiErrorKind {
  if (errorCode != null) {
    if (RATE_LIMIT_ERROR_CODES.has(errorCode)) return "RETRYABLE";
    if (errorCode === AUTH_ERROR_CODE) return "NON_RETRYABLE";
  }
  return httpStatus === 429 || httpStatus >= 500 ? "RETRYABLE" : "NON_RETRYABLE";
}

const GRAPH_API_VERSION = "v25.0";
const GRAPH_BASE_URL = "https://graph.instagram.com";

async function callGraphApi(
  path: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH_BASE_URL}/${GRAPH_API_VERSION}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify(body),
  });

  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;

  if (!res.ok) {
    const error = json.error as
      | { message?: string; code?: number; error_subcode?: number }
      | undefined;
    throw new MetaApiError(error?.message ?? `Meta API retornou HTTP ${res.status}`, {
      kind: classifyMetaError(res.status, error?.code),
      code: error?.code,
      subcode: error?.error_subcode,
      httpStatus: res.status,
    });
  }

  return json;
}

export const realMetaClient: MetaClient = {
  async sendPublicReply({ accessToken, commentId, text }) {
    await callGraphApi(`/${commentId}/replies`, accessToken, { message: text });
  },

  async sendPrivateReply({ accessToken, igUserId, commentId, text }) {
    const result = await callGraphApi(`/${igUserId}/messages`, accessToken, {
      recipient: { comment_id: commentId },
      message: { text },
    });
    return { externalMessageId: (result.message_id as string) ?? null };
  },

  async sendTextMessage({ accessToken, igUserId, recipientId, text }) {
    const result = await callGraphApi(`/${igUserId}/messages`, accessToken, {
      recipient: { id: recipientId },
      message: { text },
    });
    return { externalMessageId: (result.message_id as string) ?? null };
  },

  async sendQuickReplies({ accessToken, igUserId, recipientId, text, options }) {
    const result = await callGraphApi(`/${igUserId}/messages`, accessToken, {
      recipient: { id: recipientId },
      message: {
        text,
        quick_replies: options.map((o) => ({
          content_type: "text",
          title: o.title,
          payload: o.payload,
        })),
      },
    });
    return { externalMessageId: (result.message_id as string) ?? null };
  },
};
