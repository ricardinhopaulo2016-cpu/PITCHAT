import { describe, expect, it } from "vitest";
import { customRangeHref, periodComparison, resolvePeriod, shortcutHref } from "@/lib/metrics/period";

const NOW = new Date("2026-11-08T15:00:00.000Z"); // 12h em Brasília, 08/11

describe("atalhos de período", () => {
  it("Hoje é só o dia atual de Brasília", () => {
    const period = resolvePeriod(undefined, undefined, NOW, "hoje");
    expect(period.range).toEqual({ from: "2026-11-08", to: "2026-11-08" });
    expect(period.days).toEqual(["2026-11-08"]);
    expect(period.label).toBe("hoje");
    expect(period.choice).toBe("hoje");
    expect(period.startIso).toBe("2026-11-08T03:00:00.000Z");
    expect(period.endIso).toBe("2026-11-09T03:00:00.000Z");
  });

  it("Ontem é o dia anterior inteiro", () => {
    const period = resolvePeriod(undefined, undefined, NOW, "ontem");
    expect(period.range).toEqual({ from: "2026-11-07", to: "2026-11-07" });
    expect(period.label).toBe("ontem");
    expect(period.endIso).toBe("2026-11-08T03:00:00.000Z");
  });

  it("Últimos 3 dias inclui hoje", () => {
    const period = resolvePeriod(undefined, undefined, NOW, "3d");
    expect(period.range).toEqual({ from: "2026-11-06", to: "2026-11-08" });
    expect(period.days).toHaveLength(3);
    expect(period.label).toBe("nos últimos 3 dias");
  });

  it("Últimos 7 dias é igual ao padrão sem parâmetro", () => {
    const explicit = resolvePeriod(undefined, undefined, NOW, "7d");
    expect(explicit).toEqual(resolvePeriod(undefined, undefined, NOW));
    expect(explicit.choice).toBe("7d");
    expect(explicit.label).toBe("nos últimos 7 dias");
  });

  it("o dia vira às 03:00 UTC também nos atalhos", () => {
    expect(resolvePeriod(undefined, undefined, new Date("2026-11-08T02:59:59.000Z"), "hoje").range.from).toBe("2026-11-07");
    expect(resolvePeriod(undefined, undefined, new Date("2026-11-08T03:00:00.000Z"), "ontem").range.from).toBe("2026-11-07");
  });

  it("atalho vence datas na URL", () => {
    const period = resolvePeriod("2026-10-01", "2026-10-05", NOW, "ontem");
    expect(period.choice).toBe("ontem");
    expect(period.range.from).toBe("2026-11-07");
  });

  it("datas sem atalho são personalizado, com o rótulo do período", () => {
    const period = resolvePeriod("2026-11-01", "2026-11-03", NOW);
    expect(period.choice).toBe("personalizado");
    expect(period.label).toBe("em 01/11 a 03/11/2026");
  });

  it("personalizado de um dia só e com datas invertidas", () => {
    expect(resolvePeriod("2026-11-05", "2026-11-05", NOW).days).toEqual(["2026-11-05"]);
    expect(resolvePeriod("2026-11-03", "2026-11-01", NOW).range).toEqual({ from: "2026-11-01", to: "2026-11-03" });
  });

  it("atalho inválido não vira atalho, nem nome herdado de objeto", () => {
    expect(resolvePeriod(undefined, undefined, NOW, "constructor").choice).toBe("7d");
    expect(resolvePeriod("2026-11-01", "2026-11-03", NOW, "xyz").choice).toBe("personalizado");
    expect(resolvePeriod(undefined, undefined, NOW, ["hoje", "ontem"]).choice).toBe("7d");
  });

  it("personalizado sem datas válidas cai no padrão", () => {
    expect(resolvePeriod(undefined, undefined, NOW, "personalizado").choice).toBe("7d");
  });
});

describe("links do filtro", () => {
  const current = new URLSearchParams("channel=abc&run=a1940a6a&de=2026-10-01&ate=2026-10-05");

  it("atalho troca o período e preserva channel e run", () => {
    const href = shortcutHref("/dashboard/metrics", current, "3d");
    const url = new URL(href, "https://x.test");
    expect(url.pathname).toBe("/dashboard/metrics");
    expect(url.searchParams.get("periodo")).toBe("3d");
    expect(url.searchParams.get("channel")).toBe("abc");
    expect(url.searchParams.get("run")).toBe("a1940a6a");
    expect(url.searchParams.has("de")).toBe(false);
    expect(url.searchParams.has("ate")).toBe(false);
  });

  it("personalizado remove o atalho e preserva channel e run", () => {
    const href = customRangeHref("/dashboard/metrics", new URLSearchParams("channel=abc&run=a1940a6a&periodo=hoje"), "2026-11-01", "2026-11-03");
    const url = new URL(href, "https://x.test");
    expect(url.searchParams.has("periodo")).toBe(false);
    expect(url.searchParams.get("de")).toBe("2026-11-01");
    expect(url.searchParams.get("ate")).toBe("2026-11-03");
    expect(url.searchParams.get("channel")).toBe("abc");
    expect(url.searchParams.get("run")).toBe("a1940a6a");
  });
});

describe("periodComparison", () => {
  it("Hoje compara com ontem até a mesma hora", () => {
    const comparison = periodComparison(resolvePeriod(undefined, undefined, NOW, "hoje"), NOW);
    expect(comparison.current).toEqual({ startIso: "2026-11-08T03:00:00.000Z", endIso: "2026-11-08T15:00:00.000Z" });
    expect(comparison.previous).toEqual({ startIso: "2026-11-07T03:00:00.000Z", endIso: "2026-11-07T15:00:00.000Z" });
    expect(comparison.label).toBe("ontem até esta hora");
  });

  it("Ontem compara dia inteiro com anteontem inteiro", () => {
    const comparison = periodComparison(resolvePeriod(undefined, undefined, NOW, "ontem"), NOW);
    expect(comparison.current.endIso).toBe("2026-11-08T03:00:00.000Z");
    expect(comparison.previous).toEqual({ startIso: "2026-11-06T03:00:00.000Z", endIso: "2026-11-07T03:00:00.000Z" });
    expect(comparison.label).toBe("anteontem");
  });

  it("3 dias desloca 3 dias e corta na hora atual", () => {
    const comparison = periodComparison(resolvePeriod(undefined, undefined, NOW, "3d"), NOW);
    expect(comparison.previous).toEqual({ startIso: "2026-11-03T03:00:00.000Z", endIso: "2026-11-05T15:00:00.000Z" });
    expect(comparison.label).toBe("os 3 dias anteriores, até a mesma hora");
  });

  it("personalizado fechado usa dias inteiros e diz quantos", () => {
    const comparison = periodComparison(resolvePeriod("2026-11-01", "2026-11-03", NOW), NOW);
    expect(comparison.previous).toEqual({ startIso: "2026-10-29T03:00:00.000Z", endIso: "2026-11-01T03:00:00.000Z" });
    expect(comparison.label).toBe("os 3 dias anteriores");
    expect(periodComparison(resolvePeriod("2026-11-05", "2026-11-05", NOW), NOW).label).toBe("o dia anterior");
  });
});
