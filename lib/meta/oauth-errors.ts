/**
 * Observabilidade segura das falhas do OAuth do Instagram (D0, investigação
 * do "HTTP 400" no exchange pra long-lived token). Regra: o diagnóstico
 * completo fica no LOG DO SERVIDOR; a URL/UI só recebem um identificador
 * categorizado. Nunca entra aqui: token curto/longo, code do OAuth,
 * client_secret, URL da request (o token vai na query string dela), body da
 * request, headers de autenticação.
 */

export type InstagramOAuthOperation = "instagram_long_lived_token_exchange";

/** Erro estruturado de uma chamada do OAuth — todos os campos são seguros pra serializar/logar. */
export class InstagramOAuthError extends Error {
  readonly operation: InstagramOAuthOperation;
  readonly httpStatus: number;
  readonly metaCode?: number;
  readonly metaSubcode?: number;
  readonly metaType?: string;
  /** Identificador de suporte da Meta (não é credencial) — útil pra abrir chamado. */
  readonly fbtraceId?: string;
  readonly safeMessage: string;

  constructor(opts: {
    operation: InstagramOAuthOperation;
    httpStatus: number;
    metaCode?: number;
    metaSubcode?: number;
    metaType?: string;
    fbtraceId?: string;
    safeMessage: string;
  }) {
    const parts = [`HTTP ${opts.httpStatus}`];
    if (opts.metaCode != null) parts.push(`code ${opts.metaCode}`);
    if (opts.metaSubcode != null) parts.push(`subcode ${opts.metaSubcode}`);
    if (opts.metaType) parts.push(`type ${opts.metaType}`);
    super(`Falha no exchange pra long-lived token (${parts.join(", ")}): ${opts.safeMessage}`);
    this.name = "InstagramOAuthError";
    this.operation = opts.operation;
    this.httpStatus = opts.httpStatus;
    this.metaCode = opts.metaCode;
    this.metaSubcode = opts.metaSubcode;
    this.metaType = opts.metaType;
    this.fbtraceId = opts.fbtraceId;
    this.safeMessage = opts.safeMessage;
  }
}

const MAX_MESSAGE_LENGTH = 300;

/**
 * Remove de um texto qualquer coisa que se pareça com credencial: os valores
 * secretos conhecidos (passados pelo caller), pares `token=...`, URLs
 * inteiras (o token viaja na query string), tokens do Instagram (`IG…`) e
 * strings opacas longas. Defesa em profundidade — a Meta normalmente não
 * ecoa credenciais, mas nunca dependemos disso.
 */
export function redactSecrets(text: string, secrets: (string | undefined | null)[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 8) out = out.split(secret).join("[redacted]");
  }
  out = out
    .replace(/\b(access_token|client_secret|client_id|code|token|secret)=[^&\s"']+/gi, "$1=[redacted]")
    .replace(/https?:\/\/\S+/gi, "[url]")
    .replace(/\bIG[A-Za-z0-9_-]{20,}/g, "[redacted]")
    .replace(/\b[A-Za-z0-9_-]{40,}\b/g, "[redacted]");
  return out.length > MAX_MESSAGE_LENGTH ? `${out.slice(0, MAX_MESSAGE_LENGTH)}…` : out;
}

type MetaErrorBody = {
  error?: { message?: unknown; type?: unknown; code?: unknown; error_subcode?: unknown; fbtrace_id?: unknown };
  // formato legado de api.instagram.com/oauth
  error_type?: unknown;
  code?: unknown;
  error_message?: unknown;
};

const asNumber = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const asString = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);

/**
 * Lê a resposta de erro da Meta e monta o erro estruturado. Nunca lança por
 * body inválido: HTML/vazio/JSON estranho ainda produz um erro diagnóstico
 * (só com o HTTP status) — e o body bruto NUNCA é preservado.
 */
export async function buildInstagramOAuthError(
  operation: InstagramOAuthOperation,
  res: Response,
  secrets: (string | undefined | null)[]
): Promise<InstagramOAuthError> {
  let body: MetaErrorBody | null = null;
  try {
    const parsed: unknown = JSON.parse(await res.text());
    if (parsed && typeof parsed === "object") body = parsed as MetaErrorBody;
  } catch {
    body = null; // não-JSON (HTML, vazio, truncado)
  }

  const err = body?.error;
  const rawMessage = asString(err?.message) ?? asString(body?.error_message);
  return new InstagramOAuthError({
    operation,
    httpStatus: res.status,
    metaCode: asNumber(err?.code) ?? asNumber(body?.code),
    metaSubcode: asNumber(err?.error_subcode),
    metaType: asString(err?.type) ?? asString(body?.error_type),
    fbtraceId: asString(err?.fbtrace_id),
    safeMessage: rawMessage ? redactSecrets(rawMessage, secrets) : body ? "resposta de erro da Meta sem mensagem" : "resposta não-JSON da Meta",
  });
}

/**
 * Identificador curto e categorizado pra ir na URL (`?detail=`) — NUNCA a
 * mensagem técnica. Só contém letras minúsculas, dígitos e `_`.
 */
export function toSafeErrorDetail(err: unknown): string {
  if (err instanceof InstagramOAuthError) {
    const parts = ["long_lived_exchange_failed", `http${err.httpStatus}`];
    if (err.metaCode != null) parts.push(`code${err.metaCode}`);
    if (err.metaSubcode != null) parts.push(`sub${err.metaSubcode}`);
    return parts.join("_");
  }
  const message = err instanceof Error ? err.message : "";
  if (message.startsWith("Falha ao trocar code por token")) return "short_lived_exchange_failed";
  if (message.startsWith("Falha ao buscar identidade real")) return "identity_lookup_failed";
  return "unexpected_error";
}

/** Log server-side estruturado e seguro — o diagnóstico completo mora aqui, nunca na URL. */
export function logOAuthCallbackFailure(err: unknown, secrets: (string | undefined | null)[] = []): void {
  if (err instanceof InstagramOAuthError) {
    console.error(
      JSON.stringify({
        event: "oauth_callback_failed",
        operation: err.operation,
        httpStatus: err.httpStatus,
        metaCode: err.metaCode ?? null,
        metaSubcode: err.metaSubcode ?? null,
        metaType: err.metaType ?? null,
        fbtraceId: err.fbtraceId ?? null,
        message: err.safeMessage,
      })
    );
    return;
  }
  console.error(
    JSON.stringify({
      event: "oauth_callback_failed",
      operation: "oauth_callback",
      errorName: err instanceof Error ? err.name : typeof err,
      message: redactSecrets(err instanceof Error ? err.message : String(err), secrets),
    })
  );
}
