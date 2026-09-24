import { needsRefresh } from "@/lib/meta/oauth";
import { HEALTH_THRESHOLDS as T } from "./thresholds";

/**
 * Agregação e classificação do Health Dashboard — tudo aqui é PURO (sem I/O),
 * testável sem mockar Supabase. A página (app/dashboard/health/page.tsx) só
 * busca as linhas e chama essas funções. "Usar apenas dados que realmente
 * existem, nunca inventar métrica" (pedido do usuário, 24/09/2026) — cada
 * seção só reporta o que dá pra derivar das colunas reais.
 */

export type OperationalStatus = "operational" | "attention" | "incident";
export type SectionHealth = { status: OperationalStatus; reason: string };
export type IncidentSeverity = "info" | "warning" | "incident";
export type IncidentEntry = { severity: IncidentSeverity; at: string; label: string; detail: string };

// ---------- inputs (subconjunto de colunas — NUNCA token/secret) ----------

export type WebhookEventRow = {
  id: string;
  event_type: string;
  status: string;
  received_at: string;
  last_error: { reason?: string } | null;
};

export type AutomationRunRow = {
  id: string;
  status: string;
  waiting_reason: string | null;
  started_at: string;
  updated_at: string;
};

export type SocialAccountRow = {
  id: string;
  username: string | null;
  status: string;
  status_detail: string | null;
  token_expires_at: string | null;
};

export type JobRow = {
  id: string;
  type: string;
  status: string;
  payload: { socialAccountId?: string } | null;
  last_error: { outcome?: string; message?: string } | null;
  completed_at: string | null;
};

function minutesBetween(a: string, bIso: string): number {
  return (new Date(bIso).getTime() - new Date(a).getTime()) / 60_000;
}

// ---------- Webhook ----------

export type WebhookHealth = SectionHealth & {
  processed: number;
  pending: number;
  failed: number;
  invalidSignature: number;
  oldestPendingAgeMinutes: number | null;
  socialAccountNotFoundCount: number;
  consecutiveFailures: number;
};

export function classifyWebhookHealth(events: WebhookEventRow[], nowIso: string): WebhookHealth {
  const processed = events.filter((e) => e.status === "processed").length;
  const pending = events.filter((e) => e.status === "pending" || e.status === "processing").length;
  const failed = events.filter((e) => e.status === "failed" && e.event_type !== "invalid_signature").length;
  const invalidSignature = events.filter((e) => e.event_type === "invalid_signature").length;
  const socialAccountNotFoundCount = events.filter((e) => e.last_error?.reason === "SOCIAL_ACCOUNT_NOT_FOUND").length;

  const pendingAges = events
    .filter((e) => e.status === "pending" || e.status === "processing")
    .map((e) => minutesBetween(e.received_at, nowIso));
  const oldestPendingAgeMinutes = pendingAges.length > 0 ? Math.max(...pendingAges) : null;

  // Falhas consecutivas: das mais recentes pra trás, quantas seguidas são failed.
  const sorted = [...events].sort((a, b) => new Date(b.received_at).getTime() - new Date(a.received_at).getTime());
  let consecutiveFailures = 0;
  for (const e of sorted) {
    if (e.status === "failed") consecutiveFailures++;
    else break;
  }

  let status: OperationalStatus = "operational";
  let reason = "Sem eventos fora do esperado na janela.";

  if (invalidSignature >= T.INVALID_SIGNATURE_INCIDENT_COUNT || socialAccountNotFoundCount > 0) {
    status = "incident";
    reason =
      socialAccountNotFoundCount > 0
        ? `${socialAccountNotFoundCount} evento(s) sem social_account correspondente.`
        : `${invalidSignature} assinaturas inválidas na janela.`;
  } else if (
    invalidSignature >= T.INVALID_SIGNATURE_WARNING_COUNT ||
    (oldestPendingAgeMinutes !== null && oldestPendingAgeMinutes >= T.PENDING_WEBHOOK_STUCK_MINUTES)
  ) {
    status = "attention";
    reason =
      oldestPendingAgeMinutes !== null && oldestPendingAgeMinutes >= T.PENDING_WEBHOOK_STUCK_MINUTES
        ? `Evento pending há ${Math.round(oldestPendingAgeMinutes)} min.`
        : `${invalidSignature} assinatura(s) inválida(s) na janela.`;
  }

  return {
    status,
    reason,
    processed,
    pending,
    failed,
    invalidSignature,
    oldestPendingAgeMinutes,
    socialAccountNotFoundCount,
    consecutiveFailures,
  };
}

// ---------- Automations ----------

export type AutomationHealth = SectionHealth & {
  running: number;
  waiting: number;
  completed: number;
  failed: number;
  waitingByReason: { quick_reply: number; delay: number; retry: number };
  stuckRunning: { id: string; startedAt: string }[];
  waitingTooLong: { id: string; waitingReason: string; sinceMinutes: number }[];
  consecutiveFailures: number;
};

export function classifyAutomationHealth(runs: AutomationRunRow[], nowIso: string): AutomationHealth {
  const running = runs.filter((r) => r.status === "running").length;
  const waitingRuns = runs.filter((r) => r.status === "waiting");
  const completed = runs.filter((r) => r.status === "completed").length;
  const failed = runs.filter((r) => r.status === "failed").length;

  const waitingByReason = {
    quick_reply: waitingRuns.filter((r) => r.waiting_reason === "quick_reply").length,
    delay: waitingRuns.filter((r) => r.waiting_reason === "delay").length,
    retry: waitingRuns.filter((r) => r.waiting_reason === "retry").length,
  };

  const stuckRunning = runs
    .filter((r) => r.status === "running" && minutesBetween(r.started_at, nowIso) >= T.RUN_STUCK_RUNNING_MINUTES)
    .map((r) => ({ id: r.id, startedAt: r.started_at }));

  const waitingTooLong = waitingRuns
    .filter(
      (r) =>
        (r.waiting_reason === "delay" || r.waiting_reason === "retry") &&
        minutesBetween(r.updated_at, nowIso) >= T.WAITING_TOO_LONG_MINUTES
    )
    .map((r) => ({ id: r.id, waitingReason: r.waiting_reason!, sinceMinutes: Math.round(minutesBetween(r.updated_at, nowIso)) }));

  const sorted = [...runs]
    .filter((r) => r.status === "completed" || r.status === "failed")
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  let consecutiveFailures = 0;
  for (const r of sorted) {
    if (r.status === "failed") consecutiveFailures++;
    else break;
  }

  let status: OperationalStatus = "operational";
  let reason = "Nenhuma run travada ou esperando além do esperado.";

  if (stuckRunning.length > 0) {
    status = "incident";
    reason = `${stuckRunning.length} run(s) presa(s) em 'running' há mais de ${T.RUN_STUCK_RUNNING_MINUTES}min.`;
  } else if (consecutiveFailures >= T.CONSECUTIVE_FAILURES_WARNING || waitingTooLong.length > 0) {
    status = "attention";
    reason =
      waitingTooLong.length > 0
        ? `${waitingTooLong.length} run(s) esperando além do esperado.`
        : `${consecutiveFailures} falhas consecutivas.`;
  }

  return { status, reason, running, waiting: waitingRuns.length, completed, failed, waitingByReason, stuckRunning, waitingTooLong, consecutiveFailures };
}

// ---------- Social Accounts ----------

export type SocialAccountHealthRow = SocialAccountRow & { expiringSoon: boolean };
export type SocialAccountsHealth = SectionHealth & { accounts: SocialAccountHealthRow[] };

// Sem parâmetro `now` — `needsRefresh` (lib/meta/oauth.ts) já usa o relógio
// real internamente, não é injetável; diferente das outras classify* deste
// módulo, que recebem `nowIso` pra ficarem 100% determinísticas em teste.
export function classifySocialAccountHealth(accounts: SocialAccountRow[]): SocialAccountsHealth {
  // Nunca espalha o row de entrada inteiro (`...a`) — só os campos nomeados
  // aqui chegam no output. Defesa em profundidade: mesmo que quem chamar
  // (a página) selecione uma coluna sensível por engano no futuro, essa
  // função nunca a repassa adiante (mesmo princípio de RLS como defesa em
  // profundidade, não a única barreira — docs/PITCHAT_ARCHITECTURE.md §4).
  const rows: SocialAccountHealthRow[] = accounts.map((a) => ({
    id: a.id,
    username: a.username,
    status: a.status,
    status_detail: a.status_detail,
    token_expires_at: a.token_expires_at,
    expiringSoon: !!a.token_expires_at && needsRefresh(new Date(a.token_expires_at)),
  }));

  const hasIncident = rows.some((a) => a.status === "expired" || a.status === "error");
  const hasAttention = rows.some((a) => a.status === "connected" && a.expiringSoon);

  let status: OperationalStatus = "operational";
  let reason = "Todas as contas conectadas com token saudável.";
  if (hasIncident) {
    status = "incident";
    reason = "Uma ou mais contas precisam reconectar.";
  } else if (hasAttention) {
    status = "attention";
    reason = "Uma ou mais contas com token expirando em breve.";
  } else if (rows.length === 0) {
    reason = "Nenhuma conta conectada ainda.";
  }

  return { status, reason, accounts: rows };
}

// ---------- Token maintenance ----------

export type TokenMaintenanceOutcome =
  | "refresh_success"
  | "refresh_retryable_failure"
  | "reauth_required"
  | "refresh_non_retryable_failure"
  | "unknown";

function jobOutcome(job: JobRow): TokenMaintenanceOutcome {
  if (job.status === "succeeded") return "refresh_success";
  const outcome = job.last_error?.outcome;
  if (outcome === "refresh_retryable_failure" || outcome === "reauth_required" || outcome === "refresh_non_retryable_failure") {
    return outcome;
  }
  return "unknown";
}

export type TokenMaintenanceHealth = SectionHealth & {
  outcomeCounts: Record<TokenMaintenanceOutcome, number>;
  recent: { socialAccountId: string | null; outcome: TokenMaintenanceOutcome; at: string | null }[];
};

export function classifyTokenMaintenanceHealth(jobs: JobRow[]): TokenMaintenanceHealth {
  const refreshJobs = jobs.filter((j) => j.type === "refresh_meta_token");
  const outcomeCounts: Record<TokenMaintenanceOutcome, number> = {
    refresh_success: 0,
    refresh_retryable_failure: 0,
    reauth_required: 0,
    refresh_non_retryable_failure: 0,
    unknown: 0,
  };
  const recent = refreshJobs.map((j) => {
    const outcome = jobOutcome(j);
    outcomeCounts[outcome]++;
    return { socialAccountId: j.payload?.socialAccountId ?? null, outcome, at: j.completed_at };
  });

  let status: OperationalStatus = "operational";
  let reason = refreshJobs.length === 0 ? "Nenhum refresh de token rodou na janela." : "Refreshes recentes OK.";
  if (outcomeCounts.reauth_required > 0) {
    status = "incident";
    reason = `${outcomeCounts.reauth_required} conta(s) exigindo reconexão.`;
  } else if (outcomeCounts.refresh_retryable_failure > 0 || outcomeCounts.refresh_non_retryable_failure > 0) {
    status = "attention";
    reason = "Falha recente ao renovar token (será retentado).";
  }

  return { status, reason, outcomeCounts, recent };
}

// ---------- QStash / jobs ----------

export type QstashHealth = SectionHealth & { total: number; succeeded: number; failed: number };

export function classifyQstashHealth(jobs: JobRow[]): QstashHealth {
  const total = jobs.length;
  const succeeded = jobs.filter((j) => j.status === "succeeded").length;
  const failed = jobs.filter((j) => j.status === "failed").length;

  let status: OperationalStatus = "operational";
  let reason =
    total === 0
      ? "Nenhum job registrado na janela (sinal limitado — só o refresh de token grava em `jobs` hoje)."
      : `${succeeded}/${total} jobs concluídos com sucesso.`;
  if (failed > 0) {
    status = "attention";
    reason = `${failed} job(s) falharam na janela.`;
  }

  return { status, reason, total, succeeded, failed };
}

// ---------- Incident rail ----------

export function buildIncidentRail(input: {
  webhookEvents: WebhookEventRow[];
  automationRuns: AutomationRunRow[];
  jobs: JobRow[];
  retryAttemptCounts?: Record<string, number>; // automation_run_id -> quantas falhas já teve
  limit?: number;
}): IncidentEntry[] {
  const limit = input.limit ?? T.INCIDENT_RAIL_LIMIT;
  const entries: IncidentEntry[] = [];

  const invalidSigEvents = input.webhookEvents.filter((e) => e.event_type === "invalid_signature");
  if (invalidSigEvents.length > 0) {
    const mostRecent = invalidSigEvents.reduce((a, b) => (a.received_at > b.received_at ? a : b));
    entries.push({
      severity: invalidSigEvents.length >= T.INVALID_SIGNATURE_INCIDENT_COUNT ? "incident" : "warning",
      at: mostRecent.received_at,
      label: "invalid_signature",
      detail: `${invalidSigEvents.length} evento(s) na janela`,
    });
  }

  for (const e of input.webhookEvents) {
    if (e.last_error?.reason === "SOCIAL_ACCOUNT_NOT_FOUND") {
      entries.push({ severity: "incident", at: e.received_at, label: "SOCIAL_ACCOUNT_NOT_FOUND", detail: `evento ${e.id.slice(0, 8)}` });
    }
  }

  for (const r of input.automationRuns) {
    if (r.status === "waiting" && r.waiting_reason === "retry") {
      const attempt = input.retryAttemptCounts?.[r.id];
      entries.push({
        severity: "warning",
        at: r.updated_at,
        label: "automation retry",
        detail: attempt ? `tentativa ${attempt}/4 — run ${r.id.slice(0, 8)}` : `run ${r.id.slice(0, 8)}`,
      });
    }
    if (r.status === "failed") {
      entries.push({ severity: "warning", at: r.updated_at, label: "automation run failed", detail: `run ${r.id.slice(0, 8)}` });
    }
  }

  for (const j of input.jobs) {
    if (j.type !== "refresh_meta_token" || !j.completed_at) continue;
    const outcome = jobOutcome(j);
    const accountLabel = j.payload?.socialAccountId ? `conta ${j.payload.socialAccountId.slice(0, 8)}` : "conta desconhecida";
    entries.push({
      severity: outcome === "refresh_success" ? "info" : outcome === "reauth_required" ? "incident" : "warning",
      at: j.completed_at,
      label: `token refresh ${outcome}`,
      detail: accountLabel,
    });
  }

  return entries.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, limit);
}
