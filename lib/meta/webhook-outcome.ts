/**
 * Decide o status final de um `webhook_events` depois de processar todos os
 * eventos normalizados que ele carregava. Extraído numa função pura (mesmo
 * padrão de lib/meta/webhook-secret.ts) só pra ficar testável sem mockar
 * Supabase/QStash — usado por app/api/jobs/process-webhook-event/route.ts.
 *
 * Achado real da auditoria de 24/09/2026: até aqui, quando `externalAccountId`
 * não casava com nenhuma `social_account`, o código fazia `continue` e o
 * evento terminava marcado `processed` — sem nenhum erro visível em lugar
 * nenhum. Foi exatamente esse tipo de gap (ID da conta gravado errado no
 * OAuth) que custou tempo real de investigação nesta mesma sessão. Nunca
 * mais "processed" silencioso quando um evento não achou conta.
 */
export type EventMatchResult = {
  matched: boolean;
  eventType: string;
  externalAccountId: string;
};

export type WebhookEventOutcome = {
  status: "processed" | "failed";
  lastError: Record<string, unknown> | null;
};

export function decideWebhookEventOutcome(
  results: EventMatchResult[],
  now: () => string = () => new Date().toISOString()
): WebhookEventOutcome {
  const unmatched = results.filter((r) => !r.matched);

  if (unmatched.length === 0) {
    return { status: "processed", lastError: null };
  }

  return {
    status: "failed",
    lastError: {
      reason: "SOCIAL_ACCOUNT_NOT_FOUND",
      timestamp: now(),
      details: unmatched.map((u) => ({ eventType: u.eventType, externalAccountId: u.externalAccountId })),
    },
  };
}
