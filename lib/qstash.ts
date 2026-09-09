import { Client, Receiver } from "@upstash/qstash";
// Sem "server-only" de propósito — só funciona dentro do bundler do Next e
// quebra testes em Node puro (mesmo caso de lib/media/ffprobe.ts). Este
// módulo só é importado por Route Handlers/lib server-side, nunca por
// Client Components.

let cachedClient: Client | null | undefined;

/** Publica jobs no QStash. Server-only, precisa de QSTASH_TOKEN. */
export function getQstashClient(): Client | null {
  if (cachedClient !== undefined) return cachedClient;
  const token = process.env.QSTASH_TOKEN;
  if (!token) {
    cachedClient = null;
    return cachedClient;
  }
  cachedClient = new Client({ token });
  return cachedClient;
}

export function isQstashConfigured(): boolean {
  return !!process.env.QSTASH_TOKEN;
}

/**
 * Constrói a URL absoluta de um endpoint nosso, pro QStash chamar de volta.
 * Precisa de PITCHAT_APP_URL configurado (a URL pública onde o PITCHAT roda)
 * — QStash não consegue chamar `localhost`.
 */
export function getAppUrl(): string | null {
  return process.env.PITCHAT_APP_URL ?? null;
}

/**
 * Agenda a retomada de um automation_run depois de `minutes` — usado pelo
 * node DELAY. `deduplicationId` evita agendar o mesmo delay duas vezes se o
 * node rodar de novo por engano (idempotência).
 */
export async function scheduleAutomationResume(params: {
  automationRunId: string;
  minutes: number;
  deduplicationId: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
  const client = getQstashClient();
  const appUrl = getAppUrl();

  if (!client) return { ok: false, reason: "QSTASH_NOT_CONFIGURED" };
  if (!appUrl) return { ok: false, reason: "PITCHAT_APP_URL_NOT_CONFIGURED" };

  try {
    const res = await client.publishJSON({
      url: `${appUrl}/api/jobs/resume-automation-run`,
      body: { automationRunId: params.automationRunId },
      delay: params.minutes * 60,
      deduplicationId: params.deduplicationId,
      retries: 3,
    });
    return { ok: true, messageId: res.messageId };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "UNKNOWN_ERROR" };
  }
}

/** Agenda o processamento assíncrono de um webhook_event recém-persistido. */
export async function scheduleWebhookProcessing(params: {
  webhookEventId: string;
}): Promise<{ ok: true; messageId: string } | { ok: false; reason: string }> {
  const client = getQstashClient();
  const appUrl = getAppUrl();

  if (!client) return { ok: false, reason: "QSTASH_NOT_CONFIGURED" };
  if (!appUrl) return { ok: false, reason: "PITCHAT_APP_URL_NOT_CONFIGURED" };

  try {
    const res = await client.publishJSON({
      url: `${appUrl}/api/jobs/process-webhook-event`,
      body: { webhookEventId: params.webhookEventId },
      deduplicationId: `webhook-event:${params.webhookEventId}`,
      retries: 3,
    });
    return { ok: true, messageId: res.messageId };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "UNKNOWN_ERROR" };
  }
}

let cachedReceiver: Receiver | null | undefined;

/** Verifica a assinatura `Upstash-Signature` de um callback do QStash. */
export function getQstashReceiver(): Receiver | null {
  if (cachedReceiver !== undefined) return cachedReceiver;
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY;
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY;
  if (!currentSigningKey || !nextSigningKey) {
    cachedReceiver = null;
    return cachedReceiver;
  }
  cachedReceiver = new Receiver({ currentSigningKey, nextSigningKey });
  return cachedReceiver;
}
