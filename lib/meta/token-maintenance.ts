import { MetaApiError } from "./client";

/**
 * Classifica o resultado de uma tentativa de refresh de long-lived token —
 * decide se é transitório (o job de manutenção tenta de novo no próximo dia,
 * nunca desconecta a conta por isso) ou definitivo (marca a conta pra
 * reconexão, visível na UI de Social Accounts). Extraído numa função pura
 * só pra ficar testável sem mockar Supabase/cron/fetch — mesmo padrão de
 * lib/meta/webhook-secret.ts::getWebhookSigningSecret.
 *
 * Usado por app/api/cron/refresh-meta-tokens/route.ts.
 */
export type RefreshFailureOutcome =
  | "refresh_retryable_failure"
  | "reauth_required"
  | "refresh_non_retryable_failure";

// OAuthException — token expirado/inválido/revogado. Sempre exige
// reautenticação manual, nunca adianta tentar de novo (mesmo código usado em
// lib/meta/client.ts::AUTH_ERROR_CODE).
const TOKEN_INVALID_ERROR_CODE = 190;

export function classifyRefreshFailure(err: unknown): RefreshFailureOutcome {
  if (err instanceof MetaApiError) {
    if (err.kind === "RETRYABLE") return "refresh_retryable_failure";
    if (err.code === TOKEN_INVALID_ERROR_CODE) return "reauth_required";
    return "refresh_non_retryable_failure";
  }
  // Erro desconhecido (rede, timeout, DNS, etc) — nunca desconecta a conta
  // sem ter certeza de que é definitivo; trata como transitório, tenta de
  // novo na próxima execução diária. Só falhas realmente classificadas pela
  // Meta como definitivas desconectam.
  return "refresh_retryable_failure";
}

/** As duas outcomes que exigem reconexão manual — social_accounts.status vira 'expired'. */
export function outcomeRequiresReconnect(outcome: RefreshFailureOutcome): boolean {
  return outcome === "reauth_required" || outcome === "refresh_non_retryable_failure";
}
