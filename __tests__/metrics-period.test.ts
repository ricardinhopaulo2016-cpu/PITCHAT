import { describe, expect, it } from "vitest";
import { comparisonWindows, resolvePeriod, type WindowKey } from "@/lib/metrics/period";

const NOW = new Date("2026-11-08T15:00:00.000Z"); // 12h em Brasília

function windows(now: Date) {
  return Object.fromEntries(comparisonWindows(now).map((w) => [w.key, w])) as Record<WindowKey, ReturnType<typeof comparisonWindows>[number]>;
}

describe("resolvePeriod", () => {
  it("padrão: 7 dias incluindo hoje", () => {
    const period = resolvePeriod(undefined, undefined, NOW);
    expect(period.range).toEqual({ from: "2026-11-02", to: "2026-11-08" });
    expect(period.days).toHaveLength(7);
    expect(period.days[6]).toBe("2026-11-08");
    expect(period.isDefault).toBe(true);
    expect(period.clamped).toBe(false);
    expect(period.label).toBe("nos últimos 7 dias");
    expect(period.startIso).toBe("2026-11-02T03:00:00.000Z");
    expect(period.endIso).toBe("2026-11-09T03:00:00.000Z");
  });

  it("vira o dia às 03:00 UTC", () => {
    expect(resolvePeriod(undefined, undefined, new Date("2026-11-08T02:59:59.000Z")).range.to).toBe("2026-11-07");
    expect(resolvePeriod(undefined, undefined, new Date("2026-11-08T03:00:00.000Z")).range.to).toBe("2026-11-08");
  });

  it("ate futuro é limitado a hoje", () => {
    const period = resolvePeriod("2026-11-01", "2026-12-31", NOW);
    expect(period.range).toEqual({ from: "2026-11-01", to: "2026-11-08" });
    expect(period.clamped).toBe(false);
  });

  it("período inteiro no futuro vira hoje", () => {
    expect(resolvePeriod("2026-12-01", "2026-12-05", NOW).range).toEqual({ from: "2026-11-08", to: "2026-11-08" });
  });

  it("200 dias são limitados a 92 com clamped", () => {
    const period = resolvePeriod("2026-04-22", "2026-11-08", NOW);
    expect(period.days).toHaveLength(92);
    expect(period.range.to).toBe("2026-11-08");
    expect(period.clamped).toBe(true);
  });

  it("92 dias exatos não são limitados", () => {
    expect(resolvePeriod("2026-08-09", "2026-11-08", NOW).clamped).toBe(false);
  });

  it("com filtro o rótulo mostra o período", () => {
    const period = resolvePeriod("2026-11-01", "2026-11-03", NOW);
    expect(period.label).toBe("em 01/11 a 03/11/2026");
    expect(period.isDefault).toBe(false);
  });

  it("lixo na URL cai no padrão", () => {
    expect(resolvePeriod("abc", "xyz", NOW).isDefault).toBe(true);
  });
});

describe("comparisonWindows", () => {
  it("today termina agora", () => {
    const w = windows(NOW);
    expect(w.today.startIso).toBe("2026-11-08T03:00:00.000Z");
    expect(w.today.endIso).toBe(NOW.toISOString());
  });

  it("yesterday_same_time termina 24 h antes", () => {
    const w = windows(NOW);
    expect(w.yesterday_same_time.startIso).toBe("2026-11-07T03:00:00.000Z");
    expect(w.yesterday_same_time.endIso).toBe("2026-11-07T15:00:00.000Z");
  });

  it("yesterday é o dia inteiro", () => {
    const w = windows(NOW);
    expect(w.yesterday.startIso).toBe("2026-11-07T03:00:00.000Z");
    expect(w.yesterday.endIso).toBe("2026-11-08T03:00:00.000Z");
  });

  it("last7 não inclui hoje", () => {
    const w = windows(NOW);
    expect(w.last7.startIso).toBe("2026-11-01T03:00:00.000Z");
    expect(w.last7.endIso).toBe(w.today.startIso);
  });

  it("previous7 encosta em last7", () => {
    const w = windows(NOW);
    expect(w.previous7.endIso).toBe(w.last7.startIso);
    expect(w.previous7.startIso).toBe("2026-10-25T03:00:00.000Z");
  });
});
