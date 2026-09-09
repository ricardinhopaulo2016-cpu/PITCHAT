import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Valida o header X-Hub-Signature-256 que a Meta manda em todo webhook —
 * HMAC-SHA256 do corpo BRUTO da requisição (antes de qualquer parse),
 * usando o App Secret. Ver docs/PITCHAT_META_INTEGRATION.md §3.
 *
 * Comparação em tempo constante (timingSafeEqual) — comparar strings de
 * assinatura com `===` vaza timing information que facilita forjar a
 * assinatura por tentativa e erro.
 */
export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!signatureHeader) return false;

  const prefix = "sha256=";
  if (!signatureHeader.startsWith(prefix)) return false;

  const expectedHex = createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  const receivedHex = signatureHeader.slice(prefix.length);

  // Tamanhos diferentes: timingSafeEqual lançaria — trata como inválido direto.
  if (expectedHex.length !== receivedHex.length) return false;

  return timingSafeEqual(Buffer.from(expectedHex, "hex"), Buffer.from(receivedHex, "hex"));
}
