/**
 * Política de retry pra erros `MetaApiError` classificados como `RETRYABLE`
 * (rate limit, 5xx — ver lib/meta/client.ts::classifyMetaError). Extraído
 * numa função pura, testável sem mockar QStash/Supabase, mesmo padrão de
 * lib/meta/webhook-secret.ts.
 *
 * Erros `NON_RETRYABLE` (token inválido, requisição malformada, etc) NUNCA
 * passam por aqui — falham a run imediatamente, retry não ajudaria.
 */

// Backoff crescente: 1min, 5min, 15min — 3 tentativas depois da falha
// original (4 tentativas no total), suficiente pra um rate limit da Meta
// resetar sem deixar o usuário esperando desnecessariamente.
const BACKOFF_MINUTES = [1, 5, 15];

export const MAX_RETRY_ATTEMPTS = BACKOFF_MINUTES.length;

/**
 * `attemptNumber` = número da tentativa de retry que está prestes a rodar
 * (1-based; não conta a tentativa original que falhou). Retorna quantos
 * minutos esperar antes dela, ou `null` se já esgotou as tentativas — nesse
 * caso a run falha de vez, nunca tenta de novo.
 */
export function getRetryBackoffMinutes(attemptNumber: number): number | null {
  if (attemptNumber < 1 || attemptNumber > BACKOFF_MINUTES.length) return null;
  return BACKOFF_MINUTES[attemptNumber - 1];
}
