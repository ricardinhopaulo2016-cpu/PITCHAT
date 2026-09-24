import { describe, expect, it } from "vitest";
import {
  classifyWebhookHealth,
  classifyAutomationHealth,
  classifySocialAccountHealth,
  classifyTokenMaintenanceHealth,
  classifyQstashHealth,
  buildIncidentRail,
  type WebhookEventRow,
  type AutomationRunRow,
  type SocialAccountRow,
  type JobRow,
} from "@/lib/health/aggregate";
import { HEALTH_THRESHOLDS } from "@/lib/health/thresholds";

const NOW = "2026-09-24T12:00:00.000Z";
const minutesAgo = (m: number) => new Date(new Date(NOW).getTime() - m * 60_000).toISOString();

describe("classifyWebhookHealth", () => {
  it("empty state: sem eventos -> operational", () => {
    const result = classifyWebhookHealth([], NOW);
    expect(result.status).toBe("operational");
    expect(result.processed).toBe(0);
    expect(result.oldestPendingAgeMinutes).toBeNull();
  });

  it("conta processed/pending/failed/invalid_signature corretamente", () => {
    const events: WebhookEventRow[] = [
      { id: "1", event_type: "comments", status: "processed", received_at: minutesAgo(5), last_error: null },
      { id: "2", event_type: "comments", status: "pending", received_at: minutesAgo(2), last_error: null },
      { id: "3", event_type: "comments", status: "failed", received_at: minutesAgo(3), last_error: { reason: "SOCIAL_ACCOUNT_NOT_FOUND" } },
      { id: "4", event_type: "invalid_signature", status: "failed", received_at: minutesAgo(1), last_error: null },
    ];
    const result = classifyWebhookHealth(events, NOW);
    expect(result.processed).toBe(1);
    expect(result.pending).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.invalidSignature).toBe(1);
    expect(result.socialAccountNotFoundCount).toBe(1);
  });

  it("abaixo do threshold de invalid_signature -> operational", () => {
    const events: WebhookEventRow[] = Array.from({ length: HEALTH_THRESHOLDS.INVALID_SIGNATURE_WARNING_COUNT - 1 }, (_, i) => ({
      id: `sig-${i}`,
      event_type: "invalid_signature",
      status: "failed" as const,
      received_at: minutesAgo(1),
      last_error: null,
    }));
    expect(classifyWebhookHealth(events, NOW).status).toBe("operational");
  });

  it("no threshold de warning de invalid_signature -> attention", () => {
    const events: WebhookEventRow[] = Array.from({ length: HEALTH_THRESHOLDS.INVALID_SIGNATURE_WARNING_COUNT }, (_, i) => ({
      id: `sig-${i}`,
      event_type: "invalid_signature",
      status: "failed" as const,
      received_at: minutesAgo(1),
      last_error: null,
    }));
    expect(classifyWebhookHealth(events, NOW).status).toBe("attention");
  });

  it("no threshold de incidente de invalid_signature -> incident", () => {
    const events: WebhookEventRow[] = Array.from({ length: HEALTH_THRESHOLDS.INVALID_SIGNATURE_INCIDENT_COUNT }, (_, i) => ({
      id: `sig-${i}`,
      event_type: "invalid_signature",
      status: "failed" as const,
      received_at: minutesAgo(1),
      last_error: null,
    }));
    expect(classifyWebhookHealth(events, NOW).status).toBe("incident");
  });

  it("qualquer SOCIAL_ACCOUNT_NOT_FOUND -> incident, mesmo um só", () => {
    const events: WebhookEventRow[] = [
      { id: "1", event_type: "comments", status: "failed", received_at: minutesAgo(1), last_error: { reason: "SOCIAL_ACCOUNT_NOT_FOUND" } },
    ];
    expect(classifyWebhookHealth(events, NOW).status).toBe("incident");
  });

  it("evento pending mais velho que o threshold -> attention, calcula a idade certa", () => {
    const events: WebhookEventRow[] = [
      { id: "1", event_type: "comments", status: "pending", received_at: minutesAgo(HEALTH_THRESHOLDS.PENDING_WEBHOOK_STUCK_MINUTES + 1), last_error: null },
    ];
    const result = classifyWebhookHealth(events, NOW);
    expect(result.status).toBe("attention");
    expect(result.oldestPendingAgeMinutes).toBeGreaterThanOrEqual(HEALTH_THRESHOLDS.PENDING_WEBHOOK_STUCK_MINUTES);
  });

  it("conta falhas consecutivas só a partir do evento mais recente", () => {
    const events: WebhookEventRow[] = [
      { id: "old-ok", event_type: "comments", status: "processed", received_at: minutesAgo(10), last_error: null },
      { id: "mid-fail", event_type: "comments", status: "failed", received_at: minutesAgo(5), last_error: null },
      { id: "recent-fail", event_type: "comments", status: "failed", received_at: minutesAgo(1), last_error: null },
    ];
    // As 2 mais recentes são failed, a mais antiga (10min atrás) é processed -> só conta as 2.
    expect(classifyWebhookHealth(events, NOW).consecutiveFailures).toBe(2);
  });
});

describe("classifyAutomationHealth", () => {
  it("empty state -> operational", () => {
    const result = classifyAutomationHealth([], NOW);
    expect(result.status).toBe("operational");
    expect(result.waitingByReason).toEqual({ quick_reply: 0, delay: 0, retry: 0 });
  });

  it("separa waiting por quick_reply/delay/retry", () => {
    const runs: AutomationRunRow[] = [
      { id: "1", status: "waiting", waiting_reason: "quick_reply", started_at: minutesAgo(5), updated_at: minutesAgo(5) },
      { id: "2", status: "waiting", waiting_reason: "delay", started_at: minutesAgo(5), updated_at: minutesAgo(1) },
      { id: "3", status: "waiting", waiting_reason: "retry", started_at: minutesAgo(5), updated_at: minutesAgo(1) },
    ];
    const result = classifyAutomationHealth(runs, NOW);
    expect(result.waitingByReason).toEqual({ quick_reply: 1, delay: 1, retry: 1 });
    expect(result.waiting).toBe(3);
  });

  it("run running além do threshold -> incident (stuck)", () => {
    const runs: AutomationRunRow[] = [
      { id: "1", status: "running", waiting_reason: null, started_at: minutesAgo(HEALTH_THRESHOLDS.RUN_STUCK_RUNNING_MINUTES + 1), updated_at: minutesAgo(1) },
    ];
    const result = classifyAutomationHealth(runs, NOW);
    expect(result.status).toBe("incident");
    expect(result.stuckRunning).toHaveLength(1);
  });

  it("run running dentro do threshold -> não é stuck", () => {
    const runs: AutomationRunRow[] = [
      { id: "1", status: "running", waiting_reason: null, started_at: minutesAgo(1), updated_at: minutesAgo(1) },
    ];
    expect(classifyAutomationHealth(runs, NOW).stuckRunning).toHaveLength(0);
  });

  it("waiting em delay/retry além do threshold -> attention", () => {
    const runs: AutomationRunRow[] = [
      { id: "1", status: "waiting", waiting_reason: "delay", started_at: minutesAgo(40), updated_at: minutesAgo(HEALTH_THRESHOLDS.WAITING_TOO_LONG_MINUTES + 1) },
    ];
    const result = classifyAutomationHealth(runs, NOW);
    expect(result.status).toBe("attention");
    expect(result.waitingTooLong).toHaveLength(1);
  });

  it("waiting em quick_reply NUNCA conta como 'esperando demais' — depende de uma pessoa clicar", () => {
    const runs: AutomationRunRow[] = [
      { id: "1", status: "waiting", waiting_reason: "quick_reply", started_at: minutesAgo(999), updated_at: minutesAgo(999) },
    ];
    const result = classifyAutomationHealth(runs, NOW);
    expect(result.waitingTooLong).toHaveLength(0);
    expect(result.status).toBe("operational");
  });

  it("falhas consecutivas no threshold -> attention", () => {
    const runs: AutomationRunRow[] = Array.from({ length: HEALTH_THRESHOLDS.CONSECUTIVE_FAILURES_WARNING }, (_, i) => ({
      id: `r${i}`,
      status: "failed" as const,
      waiting_reason: null,
      started_at: minutesAgo(10 - i),
      updated_at: minutesAgo(10 - i),
    }));
    expect(classifyAutomationHealth(runs, NOW).status).toBe("attention");
  });
});

describe("classifySocialAccountHealth", () => {
  it("empty state -> operational, sem contas", () => {
    const result = classifySocialAccountHealth([]);
    expect(result.status).toBe("operational");
    expect(result.accounts).toEqual([]);
  });

  it("conta expired -> incident", () => {
    const accounts: SocialAccountRow[] = [
      { id: "1", username: "papagaio_milhas", status: "expired", status_detail: "reauth_required", token_expires_at: null },
    ];
    expect(classifySocialAccountHealth(accounts).status).toBe("incident");
  });

  it("conta conectada com token expirando em breve -> attention", () => {
    const soon = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(); // 5 dias — dentro do threshold de needsRefresh
    const accounts: SocialAccountRow[] = [{ id: "1", username: "x", status: "connected", status_detail: null, token_expires_at: soon }];
    const result = classifySocialAccountHealth(accounts);
    expect(result.status).toBe("attention");
    expect(result.accounts[0].expiringSoon).toBe(true);
  });

  it("conta conectada com token saudável -> operational", () => {
    const farFuture = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000).toISOString();
    const accounts: SocialAccountRow[] = [{ id: "1", username: "x", status: "connected", status_detail: null, token_expires_at: farFuture }];
    expect(classifySocialAccountHealth(accounts).status).toBe("operational");
  });

  // Nunca vaza dado sensível mesmo que o input (por engano de quem chama)
  // inclua um campo extra de token — a função nunca espalha o input bruto
  // pro output, só os campos que ela mesma nomeia.
  it("nunca inclui token/secret no resultado, mesmo se vier no input por engano", () => {
    const accounts = [
      {
        id: "1",
        username: "x",
        status: "connected",
        status_detail: null,
        token_expires_at: null,
        access_token_encrypted: "SEGREDO-NUNCA-DEVERIA-APARECER",
      },
    ] as unknown as SocialAccountRow[];
    const serialized = JSON.stringify(classifySocialAccountHealth(accounts));
    expect(serialized).not.toContain("SEGREDO-NUNCA-DEVERIA-APARECER");
  });
});

describe("classifyTokenMaintenanceHealth", () => {
  it("empty state -> operational", () => {
    expect(classifyTokenMaintenanceHealth([]).status).toBe("operational");
  });

  it("reauth_required -> incident", () => {
    const jobs: JobRow[] = [
      { id: "1", type: "refresh_meta_token", status: "failed", payload: { socialAccountId: "sa1" }, last_error: { outcome: "reauth_required" }, completed_at: minutesAgo(1) },
    ];
    expect(classifyTokenMaintenanceHealth(jobs).status).toBe("incident");
  });

  it("refresh_retryable_failure -> attention, não incident", () => {
    const jobs: JobRow[] = [
      { id: "1", type: "refresh_meta_token", status: "failed", payload: { socialAccountId: "sa1" }, last_error: { outcome: "refresh_retryable_failure" }, completed_at: minutesAgo(1) },
    ];
    expect(classifyTokenMaintenanceHealth(jobs).status).toBe("attention");
  });

  it("refresh_success -> operational, e contabiliza certo", () => {
    const jobs: JobRow[] = [
      { id: "1", type: "refresh_meta_token", status: "succeeded", payload: { socialAccountId: "sa1" }, last_error: null, completed_at: minutesAgo(1) },
    ];
    const result = classifyTokenMaintenanceHealth(jobs);
    expect(result.status).toBe("operational");
    expect(result.outcomeCounts.refresh_success).toBe(1);
  });

  it("ignora jobs de outro type (não refresh_meta_token)", () => {
    const jobs: JobRow[] = [{ id: "1", type: "outro_tipo_qualquer", status: "failed", payload: null, last_error: null, completed_at: minutesAgo(1) }];
    const result = classifyTokenMaintenanceHealth(jobs);
    expect(result.recent).toHaveLength(0);
  });
});

describe("classifyQstashHealth", () => {
  it("empty state -> operational, com legenda de sinal limitado", () => {
    const result = classifyQstashHealth([]);
    expect(result.status).toBe("operational");
    expect(result.reason).toMatch(/sinal limitado/i);
  });

  it("job failed -> attention", () => {
    const jobs: JobRow[] = [{ id: "1", type: "refresh_meta_token", status: "failed", payload: null, last_error: null, completed_at: minutesAgo(1) }];
    expect(classifyQstashHealth(jobs).status).toBe("attention");
  });
});

describe("buildIncidentRail", () => {
  it("empty state -> lista vazia", () => {
    expect(buildIncidentRail({ webhookEvents: [], automationRuns: [], jobs: [] })).toEqual([]);
  });

  it("ordena por horário decrescente e respeita o limite", () => {
    const webhookEvents: WebhookEventRow[] = [
      { id: "1", event_type: "comments", status: "failed", received_at: minutesAgo(50), last_error: { reason: "SOCIAL_ACCOUNT_NOT_FOUND" } },
      { id: "2", event_type: "comments", status: "failed", received_at: minutesAgo(1), last_error: { reason: "SOCIAL_ACCOUNT_NOT_FOUND" } },
    ];
    const rail = buildIncidentRail({ webhookEvents, automationRuns: [], jobs: [], limit: 1 });
    expect(rail).toHaveLength(1);
    expect(rail[0].at).toBe(minutesAgo(1));
  });

  it("nunca inclui token/secret/HMAC completo no detail de nenhuma entrada", () => {
    const jobs: JobRow[] = [
      { id: "1", type: "refresh_meta_token", status: "succeeded", payload: { socialAccountId: "sa1" }, last_error: null, completed_at: minutesAgo(1) },
    ];
    const rail = buildIncidentRail({ webhookEvents: [], automationRuns: [], jobs });
    const serialized = JSON.stringify(rail);
    expect(serialized).not.toMatch(/sha256=|Bearer |access_token/i);
  });

  it("truncando IDs técnicos — nunca expõe o UUID inteiro no detail", () => {
    const automationRuns: AutomationRunRow[] = [
      { id: "11111111-2222-3333-4444-555555555555", status: "failed", waiting_reason: null, started_at: minutesAgo(1), updated_at: minutesAgo(1) },
    ];
    const rail = buildIncidentRail({ webhookEvents: [], automationRuns, jobs: [] });
    expect(rail[0].detail).toContain("11111111"); // truncado
    expect(rail[0].detail).not.toContain("11111111-2222-3333-4444-555555555555"); // nunca o UUID inteiro
  });
});
