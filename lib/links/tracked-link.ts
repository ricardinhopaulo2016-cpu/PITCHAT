import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link rastreado do botão da DM: https://pitchat.../r/<token>.
 *
 * O token carrega só a execução (run) e o nó, assinados. O destino nunca vai
 * no link: a rota /r/ busca a URL no grafo da automação. Assim ninguém usa o
 * PITCHAT para redirecionar a um site qualquer (open redirect).
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIG_LENGTH = 16;

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

function sign(secret: string, runId: string, nodeId: string): string {
  return b64url(createHmac("sha256", secret).update(`${runId}:${nodeId}`).digest()).slice(0, SIG_LENGTH);
}

/** Segredo próprio, ou derivado da chave que já cifra os tokens da Meta. */
export function getLinkSecret(): string | null {
  if (process.env.LINK_SIGNING_SECRET) return process.env.LINK_SIGNING_SECRET;
  const key = process.env.META_TOKEN_ENCRYPTION_KEY;
  if (!key) return null;
  return createHmac("sha256", key).update("pitchat-tracked-link").digest("hex");
}

export function buildTrackedToken(runId: string, nodeId: string, secret: string): string {
  const runPart = b64url(Buffer.from(runId.replace(/-/g, ""), "hex"));
  return `${runPart}.${b64url(Buffer.from(nodeId, "utf8"))}.${sign(secret, runId, nodeId)}`;
}

export function parseTrackedToken(token: string, secret: string): { runId: string; nodeId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [runPart, nodePart, sig] = parts;
  const hex = Buffer.from(runPart, "base64url").toString("hex");
  if (hex.length !== 32) return null;
  const runId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  if (!UUID.test(runId)) return null;
  const nodeId = Buffer.from(nodePart, "base64url").toString("utf8");
  if (!nodeId || nodeId.length > 200) return null;
  const expected = Buffer.from(sign(secret, runId, nodeId));
  const given = Buffer.from(sig ?? "");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { runId, nodeId };
}

/**
 * URL que vai no botão. Sem PITCHAT_APP_URL ou sem segredo, devolve o link
 * original: o botão nunca deixa de funcionar por causa da medição.
 */
export function trackedButtonUrl(runId: string, nodeId: string, originalUrl: string): string {
  const appUrl = process.env.PITCHAT_APP_URL?.replace(/\/$/, "");
  const secret = getLinkSecret();
  if (!appUrl || !secret || !isSafeRedirectUrl(originalUrl)) return originalUrl;
  return `${appUrl}/r/${buildTrackedToken(runId, nodeId, secret)}`;
}

export function isSafeRedirectUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * A Meta abre o link para montar a prévia assim que a mensagem sai. Essa
 * visita não é a pessoa: fica gravada, mas não conta como clique.
 */
const BOT_UA = /facebookexternalhit|facebot|meta-externalagent|meta-externalfetcher|instagram.*bot|bot\b|crawler|spider|preview|curl|wget|python-requests|headless/i;

export function isBotUserAgent(userAgent: string | null): boolean {
  if (!userAgent) return true;
  return BOT_UA.test(userAgent);
}
