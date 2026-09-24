// Sem "server-only" de propósito — só funciona dentro do bundler do Next e
// quebra testes em Node puro (mesmo caso de lib/media/ffprobe.ts). Este
// cliente recebe o access token por parâmetro (nunca lê token/secret de env
// global) — só META_API_VERSION vem de env, e não é secret — então nem faz
// sentido protegê-lo contra import client-side por esse motivo.

/**
 * Cliente HTTP real da Instagram Graph API (Instagram API with Instagram
 * Login). Endpoints conforme docs/PITCHAT_META_INTEGRATION.md — ainda NÃO
 * testado contra a API real (bloqueado até existir Meta App + Instagram
 * conectado, ver checklist no doc). O restante do sistema depende só da
 * interface `MetaClient`, nunca chama fetch direto — troca de implementação
 * (ex: um FakeMetaClient em teste) não exige mexer em mais nada.
 */

import { getGraphApiVersion } from "./api-version";

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

/**
 * Botão do Button Template (docs/PITCHAT_META_INTEGRATION.md §5, confirmado
 * na doc oficial em 24/09/2026): até 3 por mensagem, `web_url` abre link,
 * `postback` dispara `messaging_postbacks` com o `payload` definido por nós
 * (nunca o título — mesma regra do quick reply).
 */
export type ButtonTemplateButton =
  | { type: "web_url"; title: string; url: string }
  | { type: "postback"; title: string; payload: string };

export interface MetaClient {
  /** Resposta pública a um comentário. POST /{comment-id}/replies */
  sendPublicReply(params: { accessToken: string; commentId: string; text: string }): Promise<void>;

  /**
   * Private reply — só funciona 1x por comentário, dentro de 7 dias.
   * POST /{ig-user-id}/messages, recipient.comment_id. `quickReplies`
   * (opcional) tenta anexar os botões NA MESMA mensagem — ver achado real
   * 24/09/2026 em lib/automation/engine.ts sobre por que isso existe.
   */
  sendPrivateReply(params: {
    accessToken: string;
    igUserId: string;
    commentId: string;
    text: string;
    quickReplies?: { title: string; payload: string }[];
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

  /** Button Template — texto até 640 chars + até 3 botões (web_url/postback). */
  sendButtonTemplate(params: {
    accessToken: string;
    igUserId: string;
    recipientId: string;
    text: string;
    buttons: ButtonTemplateButton[];
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

const GRAPH_BASE_URL = "https://graph.instagram.com";

async function callGraphApi(
  path: string,
  accessToken: string,
  body: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const res = await fetch(`${GRAPH_BASE_URL}/${getGraphApiVersion()}${path}`, {
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

  async sendPrivateReply({ accessToken, igUserId, commentId, text, quickReplies }) {
    const message: Record<string, unknown> = { text };
    // A doc oficial de Private Reply só mostra exemplo com `text` — nunca
    // confirmado nem negado explicitamente que `quick_replies` funciona
    // junto (ver achado real 24/09/2026, comentário em
    // lib/automation/engine.ts). Anexa quando pedido; se a Meta rejeitar,
    // o erro real fica capturado em automation_run_steps.error — decide-se
    // a partir daí, nunca de suposição.
    if (quickReplies && quickReplies.length > 0) {
      message.quick_replies = quickReplies.map((q) => ({
        content_type: "text",
        title: q.title,
        payload: q.payload,
      }));
    }
    const result = await callGraphApi(`/${igUserId}/messages`, accessToken, {
      recipient: { comment_id: commentId },
      message,
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

  async sendButtonTemplate({ accessToken, igUserId, recipientId, text, buttons }) {
    const result = await callGraphApi(`/${igUserId}/messages`, accessToken, {
      recipient: { id: recipientId },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text,
            buttons: buttons.map((b) =>
              b.type === "web_url"
                ? { type: "web_url", title: b.title, url: b.url }
                : { type: "postback", title: b.title, payload: b.payload }
            ),
          },
        },
      },
    });
    return { externalMessageId: (result.message_id as string) ?? null };
  },
};
