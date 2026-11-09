import { describe, expect, it } from "vitest";
import { funnelVerdict, nodeVerdict, topNodeBottleneck, worstFunnelLoss } from "@/lib/metrics/bottleneck";
import { axisTicks, isolatedIndexes, linePath, niceCeil, tooltipSide, xTickIndexes } from "@/lib/metrics/chart";
import type { Sources } from "@/lib/metrics/daily";
import { buildNodeFailures, type Incident, type RawFailures } from "@/lib/metrics/failures";
import { buildFunnel, type FunnelCounts } from "@/lib/metrics/funnel";
import { buildKpis, readObservedValue, type KpiInput } from "@/lib/metrics/overview";
import { periodComparison, resolvePeriod } from "@/lib/metrics/period";

const COUNTS: FunnelCounts = { comments_valid: 500, requests_unique: 100, requests_without_author: 0, executions: 90, first_dm: 80, button: 30, link_button: 20, quick_reply_button: 10 };

describe("worstFunnelLoss", () => {
  it("aponta a passagem que mais perde gente", () => {
    const loss = worstFunnelLoss(buildFunnel(COUNTS));
    expect(loss?.to.key).toBe("button");
    expect(loss?.lost).toBe(50);
  });

  it("comentário sem a frase não conta como perda", () => {
    const loss = worstFunnelLoss(buildFunnel({ ...COUNTS, comments_valid: 100000 }));
    expect(loss?.from.key).not.toBe("comments");
  });

  it("no empate fica a etapa mais cedo", () => {
    const loss = worstFunnelLoss(buildFunnel({ ...COUNTS, executions: 80, first_dm: 60, button: 40 }));
    expect(loss?.to.key).toBe("executions");
  });

  it("sem perda devolve nulo", () => {
    expect(worstFunnelLoss(buildFunnel({ ...COUNTS, executions: 100, first_dm: 100, button: 100 }))).toBeNull();
    expect(worstFunnelLoss(buildFunnel({ ...COUNTS, requests_unique: 0, executions: 0, first_dm: 0, button: 0 }))).toBeNull();
  });
});

describe("topNodeBottleneck", () => {
  const nodes = buildNodeFailures([
    { automation_id: "a1", automation_name: "Fluxo", node_id: "n1", node_type: "PRIVATE_REPLY", failures: 8, reached: 20 },
    { automation_id: "a1", automation_name: "Fluxo", node_id: "n2", node_type: "SEND_MESSAGE", failures: 2, reached: 10 },
  ]);
  const incident = (over: Partial<Incident>): Incident => ({ runShort: "aaaaaaaa", status: "failed", at: "2026-11-01T10:00:00Z", automationId: "a1", automationName: "Fluxo", automationInactive: false, accountId: null, nodeLabel: "Primeira DM", nodeId: "n1", stepFailed: true, cause: "Erro A", ...over });

  it("sem falha por nó devolve nulo", () => {
    expect(topNodeBottleneck([], [])).toBeNull();
  });

  it("usa a causa mais frequente e aponta o incidente mais recente dela", () => {
    const top = topNodeBottleneck(nodes, [incident({ runShort: "11111111", cause: "Erro B" }), incident({ runShort: "22222222" }), incident({ runShort: "33333333" })]);
    expect(top?.cause).toBe("Erro A");
    expect(top?.incident?.runShort).toBe("22222222");
  });

  it("execução sem etapa falha no nó não vota na causa nem vira o link", () => {
    const top = topNodeBottleneck(nodes, [incident({ runShort: "11111111", stepFailed: false, cause: "Causa não registrada" }), incident({ runShort: "22222222", stepFailed: false, cause: "Causa não registrada" }), incident({ runShort: "33333333" })]);
    expect(top?.cause).toBe("Erro A");
    expect(top?.incident?.runShort).toBe("33333333");
  });

  it("não confunde nó de mesmo id em outra automação nem execução presa", () => {
    const top = topNodeBottleneck(nodes, [incident({ automationId: "a2" }), incident({ status: "running" })]);
    expect(top?.cause).toBeNull();
    expect(top?.incident).toBeNull();
    expect(top?.node.failures).toBe(8);
  });
});

describe("funnelVerdict", () => {
  const noRequests = { ...COUNTS, requests_unique: 0, executions: 0, first_dm: 0, button: 0, link_button: 0, quick_reply_button: 0 };

  it("sem conta ou com zero pedidos é sem base, não ausência de perda", () => {
    expect(funnelVerdict([])).toEqual({ kind: "no_base" });
    expect(funnelVerdict([noRequests])).toEqual({ kind: "no_base" });
  });

  it("com pedidos e sem queda não há perda", () => {
    expect(funnelVerdict([{ ...COUNTS, executions: 100, first_dm: 100, button: 100 }])).toEqual({ kind: "no_loss" });
  });

  it("com queda aponta a perda", () => {
    const verdict = funnelVerdict([COUNTS]);
    expect(verdict.kind).toBe("loss");
    if (verdict.kind === "loss") expect(verdict.loss.lost).toBe(50);
  });
});

describe("nodeVerdict", () => {
  const raw: RawFailures = { runs_in_period: 5, failed_runs: 0, failed_without_step: 0, stuck_runs: 0, retry_attempts: 0, by_node: [], errors: [], incidents: [] };

  it("verde só com zero falhas e fonte observada", () => {
    expect(nodeVerdict(raw, true)).toEqual({ kind: "healthy" });
    expect(nodeVerdict(raw, false)).toEqual({ kind: "no_base" });
  });

  it("falhas sem etapa não passam por saudável", () => {
    expect(nodeVerdict({ ...raw, failed_runs: 3, failed_without_step: 3 }, true)).toEqual({ kind: "without_step", failures: 3 });
  });

  it("falha por nó vem primeiro", () => {
    const verdict = nodeVerdict({ ...raw, failed_runs: 1, by_node: [{ automation_id: "a", automation_name: "Fluxo", node_id: "n", node_type: "SEND_MESSAGE", failures: 1, reached: 2 }] }, true);
    expect(verdict.kind).toBe("node");
  });
});

describe("readObservedValue", () => {
  const span = { first: "2026-11-01T00:00:00Z", last: null };
  const window = { startIso: "2026-11-05T00:00:00Z", endIso: "2026-11-06T00:00:00Z" };

  it("com observação anterior à janela é completo", () => {
    expect(readObservedValue(0, span, window)).toEqual({ value: 0, coverage: "complete" });
  });

  it("fonte que começou depois do início é parcial", () => {
    expect(readObservedValue(3, { first: "2026-11-05T12:00:00Z", last: null }, window)).toEqual({ value: 3, coverage: "partial" });
  });

  it("zero sem observação não vira zero", () => {
    expect(readObservedValue(0, { first: null, last: null }, window).value).toBeNull();
    expect(readObservedValue(0, { first: "2026-11-07T00:00:00Z", last: null }, window).value).toBeNull();
    expect(readObservedValue(null, span, window).value).toBeNull();
  });
});

describe("buildKpis", () => {
  const NOW = new Date("2026-11-08T15:00:00.000Z");
  const span = { first: "2026-01-01T00:00:00Z", last: null };
  const sources: Sources = { comments: span, messages_inbound: span, messages_outbound: span, runs: span, posts: span };
  const base: KpiInput = {
    comparison: periodComparison(resolvePeriod(undefined, undefined, NOW, "3d"), NOW),
    sources,
    funnel: COUNTS,
    previousFunnel: { ...COUNTS, requests_unique: 50, button: 60 },
    currentTotals: { run_started: 110, dm_automation: 70, dm_manual: 5, failure_run: 4, failure_message: 2 },
    previousTotals: { run_started: 100, dm_automation: 70, dm_manual: 5, failure_run: 1, failure_message: 1 },
    latency: { samples: 25, p50: 30, p95: 60 },
    previousLatency: { samples: 25, p50: 60, p95: 90 },
  };
  const get = (input: KpiInput, key: string) => buildKpis(input).find((kpi) => kpi.key === key)!;

  it("seis indicadores, na ordem do topo", () => {
    expect(buildKpis(base).map((kpi) => kpi.key)).toEqual(["requests", "runs", "dms", "button", "failures", "latency"]);
  });

  it("variação com sinal e direção", () => {
    expect(get(base, "requests")).toMatchObject({ display: "100", deltaText: "+100%", trend: "good", baseline: "50" });
    expect(get(base, "button")).toMatchObject({ deltaText: "-50%", trend: "bad" });
  });

  it("falha e tempo subindo é ruim, descendo é bom", () => {
    expect(get(base, "failures")).toMatchObject({ display: "6", deltaText: "+200%", trend: "bad", alert: true });
    expect(get(base, "latency")).toMatchObject({ display: "30s", deltaText: "-50%", trend: "good", baseline: "1min" });
  });

  it("variação em 0% fica neutra", () => {
    expect(get(base, "dms")).toMatchObject({ display: "75", deltaText: "0%", trend: "flat", caption: "70 automação, 5 Inbox" });
  });

  it("legenda de DMs com uma fonte ausente diz sem base", () => {
    expect(get({ ...base, sources: null, currentTotals: { dm_manual: 3 } }, "dms").caption).toBe("automação: sem base, Inbox: 3");
    expect(get({ ...base, sources: null, currentTotals: { dm_automation: 7 } }, "dms").caption).toBe("automação: 7, Inbox: sem base");
  });

  it("sem base anterior não inventa variação", () => {
    const input = { ...base, previousFunnel: null, previousTotals: null, previousLatency: null };
    for (const kpi of buildKpis(input)) {
      expect(kpi.deltaText).toBe("sem base");
      expect(kpi.trend).toBeNull();
      expect(kpi.baseline).toBeNull();
    }
  });

  it("base zero não vira porcentagem", () => {
    expect(get({ ...base, previousFunnel: { ...COUNTS, requests_unique: 0 } }, "requests")).toMatchObject({ deltaText: "sem base", trend: null });
  });

  it("janela anterior observada só em parte não sustenta variação", () => {
    const late = { first: "2026-11-04T00:00:00Z", last: null };
    const partial: Sources = { comments: late, messages_inbound: late, messages_outbound: late, runs: late, posts: late };
    for (const kpi of buildKpis({ ...base, sources: partial })) expect(kpi.trend).toBeNull();
  });

  it("sem dado nenhum aparece sem base, nunca zero", () => {
    const input: KpiInput = { ...base, sources: null, funnel: null, previousFunnel: null, currentTotals: null, previousTotals: null, latency: null, previousLatency: null };
    for (const kpi of buildKpis(input)) {
      expect(kpi.display).toBe("sem base");
      expect(kpi.hasValue).toBe(false);
      expect(kpi.alert).toBe(false);
    }
  });

  it("mediana com poucas amostras fica sem base", () => {
    expect(get({ ...base, latency: { samples: 2, p50: null, p95: null } }, "latency")).toMatchObject({ display: "sem base", caption: "2 amostras", trend: null });
  });
});

describe("escala do gráfico", () => {
  it("teto redondo", () => {
    expect([0, 1, 2, 3, 7, 12, 95, 1000, 1001].map(niceCeil)).toEqual([1, 1, 2, 5, 10, 20, 100, 1000, 2000]);
  });

  it("marcas do eixo só com número inteiro", () => {
    expect(axisTicks(10)).toEqual([10, 5, 0]);
    expect(axisTicks(5)).toEqual([5, 0]);
    expect(axisTicks(1)).toEqual([1, 0]);
  });

  it("rótulos do eixo X sempre incluem o último dia", () => {
    expect(xTickIndexes(3)).toEqual([0, 1, 2]);
    const many = xTickIndexes(92);
    expect(many.at(-1)).toBe(91);
    expect(many.length).toBeLessThanOrEqual(8);
  });

  it("dica não abre para o lado que não cabe", () => {
    expect([0, 1, 2].map((index) => tooltipSide(index, 3))).toEqual(["right", "center", "left"]);
    expect([0, 1, 2, 3, 4, 5, 6].map((index) => tooltipSide(index, 7))).toEqual(["right", "right", "center", "center", "center", "left", "left"]);
  });

  it("em largura estreita os 7 dias têm menos rótulos e mantêm o último", () => {
    expect(xTickIndexes(7, 4)).toEqual([0, 2, 4, 6]);
  });

  it("dia sem dado interrompe a linha em vez de cair a zero", () => {
    const path = linePath([1, null, 2, 2], 2);
    expect(path).toBe("M12.5 50 M62.5 0 L87.5 0");
  });

  it("marca pontos sem vizinho", () => {
    expect(isolatedIndexes([null, 1, null, 2, 3])).toEqual([1]);
    expect(isolatedIndexes([1])).toEqual([0]);
  });
});
