import { describe, expect, it } from "vitest";
import type { NodeFailure } from "@/lib/metrics/failures";
import type { QueueState } from "@/lib/metrics/flow";
import type { FunnelCounts } from "@/lib/metrics/funnel";
import { buildInsights, type InsightInput } from "@/lib/metrics/insights";

const PERIOD = "nos últimos 7 dias";
const NOON_SP = new Date("2026-11-08T15:00:00.000Z");

const base: InsightInput = {
  periodLabel: PERIOD,
  now: NOON_SP,
  funnel: null,
  failures: null,
  internalLatency: null,
  peak: null,
  activeHours: 0,
  averageHourly: null,
  queue: null,
  postsUnlinked: null,
  todayRequests: null,
  yesterdaySameTimeRequests: null,
  bestGoalPost: null,
};

function funnel(partial: Partial<FunnelCounts>): FunnelCounts {
  return { comments_valid: 0, requests_unique: 0, requests_without_author: 0, executions: 0, first_dm: 0, button: 0, link_button: 0, quick_reply_button: 0, ...partial };
}
function node(failures: number): NodeFailure {
  return { automationId: "a", automationName: "Fluxo A", nodeId: "n", nodeLabel: "Primeira DM", failures, reached: 100, rate: { kind: "value", value: 0.1 } };
}
function waiting(delay: number, retry: number, oldestMinutes: number | null): QueueState {
  return { messageQueue: { kind: "not_recorded" }, runs: { delay, retry, oldestMinutes }, awaitingPerson: 0 };
}
function goalPost(requests: number) {
  return { accountId: "acc", mediaId: "m", permalink: null, requests, progress: requests / 1000 };
}
const ids = (input: Partial<InsightInput>) => buildInsights({ ...base, ...input }).map((i) => i.id);

describe("cada regra no limiar e 1 abaixo", () => {
  it("pending_execution: 5 sim, 4 não", () => {
    expect(ids({ funnel: funnel({ requests_unique: 5 }) })).toContain("pending_execution");
    expect(ids({ funnel: funnel({ requests_unique: 4 }) })).not.toContain("pending_execution");
  });

  it("execution_without_dm: 3 sim, 2 não", () => {
    expect(ids({ funnel: funnel({ requests_unique: 3, executions: 3 }) })).toContain("execution_without_dm");
    expect(ids({ funnel: funnel({ requests_unique: 2, executions: 2 }) })).not.toContain("execution_without_dm");
  });

  it("node_failure_concentrated: 5 falhas e metade", () => {
    expect(ids({ failures: { failedRuns: 10, topNode: node(5) } })).toContain("node_failure_concentrated");
    expect(ids({ failures: { failedRuns: 10, topNode: node(4) } })).not.toContain("node_failure_concentrated");
    expect(ids({ failures: { failedRuns: 11, topNode: node(5) } })).not.toContain("node_failure_concentrated");
    expect(ids({ failures: { failedRuns: 10, topNode: null } })).not.toContain("node_failure_concentrated");
  });

  it("stale_waiting: 30 min sim, 29 não, sem execução não", () => {
    expect(ids({ queue: waiting(1, 0, 30) })).toContain("stale_waiting");
    expect(ids({ queue: waiting(1, 0, 29) })).not.toContain("stale_waiting");
    expect(ids({ queue: waiting(0, 0, 60) })).not.toContain("stale_waiting");
    expect(ids({ queue: waiting(1, 0, null) })).not.toContain("stale_waiting");
  });

  it("low_button_rate: 20 DMs e abaixo de 50%", () => {
    expect(ids({ funnel: funnel({ requests_unique: 20, executions: 20, first_dm: 20, button: 9 }) })).toContain("low_button_rate");
    expect(ids({ funnel: funnel({ requests_unique: 20, executions: 20, first_dm: 20, button: 10 }) })).not.toContain("low_button_rate");
    expect(ids({ funnel: funnel({ requests_unique: 19, executions: 19, first_dm: 19, button: 0 }) })).not.toContain("low_button_rate");
  });

  it("requests_drop: ontem 10 e hoje até metade, a partir das 6h", () => {
    expect(ids({ todayRequests: 5, yesterdaySameTimeRequests: 10 })).toContain("requests_drop");
    expect(ids({ todayRequests: 6, yesterdaySameTimeRequests: 10 })).not.toContain("requests_drop");
    expect(ids({ todayRequests: 4, yesterdaySameTimeRequests: 9 })).not.toContain("requests_drop");
    const sixAm = new Date("2026-11-08T09:00:00.000Z");
    const beforeSix = new Date("2026-11-08T08:59:00.000Z");
    expect(ids({ now: sixAm, todayRequests: 0, yesterdaySameTimeRequests: 10 })).toContain("requests_drop");
    expect(ids({ now: beforeSix, todayRequests: 0, yesterdaySameTimeRequests: 10 })).not.toContain("requests_drop");
  });

  it("slow_internal: 20 amostras e p95 acima de 120s", () => {
    expect(ids({ internalLatency: { samples: 20, p50: 10, p95: 121 } })).toContain("slow_internal");
    expect(ids({ internalLatency: { samples: 20, p50: 10, p95: 120 } })).not.toContain("slow_internal");
    expect(ids({ internalLatency: { samples: 19, p50: 10, p95: 500 } })).not.toContain("slow_internal");
    expect(ids({ internalLatency: { samples: 20, p50: 10, p95: null } })).not.toContain("slow_internal");
  });

  it("unlinked_posts: 3 sim, 2 não", () => {
    expect(ids({ postsUnlinked: 3 })).toContain("unlinked_posts");
    expect(ids({ postsUnlinked: 2 })).not.toContain("unlinked_posts");
  });

  it("traffic_peak: 24 horas, 20 mensagens e 3x a média", () => {
    const peak = { hour: "2026-11-08T14", total: 20 };
    expect(ids({ peak, activeHours: 24, averageHourly: 20 / 3 })).toContain("traffic_peak");
    expect(ids({ peak, activeHours: 23, averageHourly: 2 })).not.toContain("traffic_peak");
    expect(ids({ peak: { ...peak, total: 19 }, activeHours: 24, averageHourly: 2 })).not.toContain("traffic_peak");
    expect(ids({ peak, activeHours: 24, averageHourly: 7 })).not.toContain("traffic_peak");
    expect(ids({ peak, activeHours: 24, averageHourly: null })).not.toContain("traffic_peak");
  });

  it("goal_close: 500 sim, 499 não", () => {
    expect(ids({ bestGoalPost: goalPost(500) })).toContain("goal_close");
    expect(ids({ bestGoalPost: goalPost(499) })).not.toContain("goal_close");
  });
});

describe("frases", () => {
  const everyRule: InsightInput = {
    ...base,
    funnel: funnel({ requests_unique: 50, executions: 30, first_dm: 25, button: 2 }),
    failures: { failedRuns: 8, topNode: { ...node(6), automationName: "Fluxo — teste" } },
    internalLatency: { samples: 40, p50: 30, p95: 300 },
    peak: { hour: "2026-11-08T14", total: 90 },
    activeHours: 30,
    averageHourly: 5,
    queue: waiting(2, 1, 45),
    postsUnlinked: 4,
    todayRequests: 1,
    yesterdaySameTimeRequests: 20,
    bestGoalPost: goalPost(700),
  };
  const all = buildInsights(everyRule);

  it("sem nenhuma fonte, nenhuma frase", () => {
    expect(buildInsights(base)).toEqual([]);
  });

  it("teto de 6, na ordem de prioridade", () => {
    expect(all.map((i) => i.id)).toEqual([
      "pending_execution",
      "execution_without_dm",
      "node_failure_concentrated",
      "stale_waiting",
      "low_button_rate",
      "requests_drop",
    ]);
  });

  it("regras de menor prioridade aparecem quando sobra espaço", () => {
    expect(ids({ internalLatency: { samples: 40, p50: 30, p95: 300 }, postsUnlinked: 4, peak: { hour: "2026-11-08T14", total: 90 }, activeHours: 30, averageHourly: 5, bestGoalPost: goalPost(700) })).toEqual([
      "slow_internal",
      "unlinked_posts",
      "traffic_peak",
      "goal_close",
    ]);
  });

  const late = buildInsights({ ...everyRule, funnel: null, failures: null, queue: null, todayRequests: null });

  it.each([...all, ...late].map((insight) => [insight.id, insight] as const))("%s tem número, período e ação", (_id, insight) => {
    expect(insight.text).toMatch(/\d/);
    expect(insight.periodLabel.length).toBeGreaterThan(0);
    expect(insight.action.length).toBeGreaterThan(0);
    expect(typeof insight.value).toBe("number");
  });

  it("nenhum texto contém o travessão longo", () => {
    const text = JSON.stringify([...all, ...late]);
    expect(text).not.toContain("—");
  });

  it("escreve as frases definidas", () => {
    expect(buildInsights({ ...base, funnel: funnel({ requests_unique: 12 }) })[0].text).toBe(`12 pedidos sem execução de automação ${PERIOD}.`);
    expect(buildInsights({ ...base, queue: waiting(1, 0, 45) })[0].text).toBe("1 execução em espera agora, a mais antiga há 45 min.");
    expect(buildInsights({ ...base, queue: waiting(1, 1, 45) })[0].text).toBe("2 execuções em espera agora, a mais antiga há 45 min.");
    expect(buildInsights({ ...base, bestGoalPost: goalPost(700) })[0]).toMatchObject({
      text: "Um post chegou a 700 de 1.000 pedidos únicos, em todo o histórico.",
      periodLabel: "em todo o histórico",
    });
    expect(buildInsights({ ...base, peak: { hour: "2026-11-08T14", total: 90 }, activeHours: 30, averageHourly: 5 })[0].text).toBe(`Pico de 90 mensagens em 08/11 às 14h ${PERIOD}.`);
    expect(buildInsights({ ...base, internalLatency: { samples: 40, p50: 30, p95: 300 } })[0].text).toBe(`Entre os pedidos que receberam DM ${PERIOD}, 95% receberam em até 5min depois do comentário (horário real do Instagram quando disponível, senão a gravação), em 40 amostras.`);
  });

  it("sugere link em falha por nó e fila", () => {
    const hrefs = Object.fromEntries(all.map((i) => [i.id, i.href]));
    expect(hrefs.node_failure_concentrated).toBe("#falhas");
    expect(hrefs.stale_waiting).toBe("/dashboard/health");
  });
});
