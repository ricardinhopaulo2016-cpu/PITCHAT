import { describe, expect, it } from "vitest";
import { buildDailySeries, EVENT_SOURCE, isObservedBy, observedCount, readWindow, windowDelta, type EventKind, type Sources, type WindowReading } from "@/lib/metrics/daily";

const span = (first: string | null) => ({ first, last: first });
const SOURCES: Sources = {
  comments: span("2026-11-03T12:00:00.123456+00:00"),
  messages_inbound: span(null),
  messages_outbound: span("2026-11-01T12:00:00+00:00"),
  runs: span(null),
  posts: span("2026-11-01T12:00:00+00:00"),
};
const DAYS = ["2026-11-02", "2026-11-03", "2026-11-04"];
const TODAY = "2026-11-04";

describe("buildDailySeries", () => {
  it("dia antes da 1ª observação é null", () => {
    expect(buildDailySeries([], DAYS, SOURCES, TODAY)[0].values.comment_valid).toBeNull();
  });

  it("dia da 1ª observação e seguintes, sem linha, são 0", () => {
    const series = buildDailySeries([], DAYS, SOURCES, TODAY);
    expect(series[1].values.comment_valid).toBe(0);
    expect(series[2].values.comment_valid).toBe(0);
  });

  it("fonte sem first nunca gera 0", () => {
    expect(buildDailySeries([], DAYS, SOURCES, TODAY)[2].values.run_started).toBeNull();
  });

  it("primeiro dia é contado no fuso de Brasília", () => {
    const sources = { ...SOURCES, comments: span("2026-11-04T01:00:00+00:00") }; // 22h do dia 3 em Brasília
    expect(buildDailySeries([], DAYS, sources, TODAY)[1].values.comment_valid).toBe(0);
  });

  it("sources nulo não gera 0", () => {
    const series = buildDailySeries([], DAYS, null, TODAY);
    expect(series.flatMap((row) => Object.values(row.values)).every((value) => value === null)).toBe(true);
  });

  it("valor presente é o valor, mesmo sem sources", () => {
    const series = buildDailySeries([{ day: "2026-11-03", kind: "comment_valid", count: 7 }], DAYS, null, TODAY);
    expect(series[1].values.comment_valid).toBe(7);
  });

  it("hoje é parcial", () => {
    expect(buildDailySeries([], DAYS, SOURCES, TODAY).map((row) => row.partial)).toEqual([false, false, true]);
  });

  it("cada EventKind usa a fonte certa", () => {
    const expected: Record<EventKind, keyof Sources> = {
      post_published: "posts",
      comment_valid: "comments",
      request_unique: "comments",
      run_started: "runs",
      failure_run: "runs",
      dm_automation: "messages_outbound",
      dm_manual: "messages_outbound",
      failure_message: "messages_outbound",
    };
    expect(EVENT_SOURCE).toEqual(expected);
    const onlyRuns: Sources = { ...SOURCES, comments: span(null), messages_outbound: span(null), posts: span(null), runs: span("2026-11-01T00:00:00Z") };
    const values = buildDailySeries([], ["2026-11-03"], onlyRuns, TODAY)[0].values;
    for (const kind of Object.keys(expected) as EventKind[]) {
      expect(values[kind]).toBe(expected[kind] === "runs" ? 0 : null);
    }
  });
});

describe("readWindow", () => {
  const WINDOW = { startIso: "2026-11-02T03:00:00.000Z", endIso: "2026-11-05T03:00:00.000Z" };
  const BEFORE_FIRST = { startIso: "2026-11-04T03:00:00.000Z", endIso: "2026-11-05T03:00:00.000Z" };

  it("totals nulo é sem dado e cobertura desconhecida", () => {
    expect(readWindow("comment_valid", null, WINDOW, SOURCES)).toEqual({ value: null, coverage: "unknown" });
  });

  it("valor presente é o valor, mesmo sem sources, mas sem cobertura conhecida", () => {
    expect(readWindow("comment_valid", { comment_valid: 9 }, WINDOW, null)).toEqual({ value: 9, coverage: "unknown" });
  });

  it("primeira observação no meio da janela é parcial", () => {
    expect(readWindow("comment_valid", { comment_valid: 20 }, WINDOW, SOURCES)).toEqual({ value: 20, coverage: "partial" });
    expect(readWindow("comment_valid", {}, WINDOW, SOURCES)).toEqual({ value: 0, coverage: "partial" });
  });

  it("primeira observação antes do início é completa", () => {
    expect(readWindow("comment_valid", { comment_valid: 20 }, BEFORE_FIRST, SOURCES)).toEqual({ value: 20, coverage: "complete" });
    expect(readWindow("comment_valid", {}, BEFORE_FIRST, SOURCES)).toEqual({ value: 0, coverage: "complete" });
  });

  it("ausente vira null sem first ou com first depois do fim", () => {
    expect(readWindow("run_started", {}, WINDOW, SOURCES).value).toBeNull();
    expect(readWindow("comment_valid", {}, { startIso: "2026-11-01T03:00:00.000Z", endIso: "2026-11-03T12:00:00.000Z" }, SOURCES).value).toBeNull();
  });

  it("compara instantes, não texto", () => {
    const sources = { ...SOURCES, comments: span("2026-11-02T04:00:00+01:00") }; // 03:00 UTC, igual ao início
    expect(readWindow("comment_valid", {}, WINDOW, sources)).toEqual({ value: 0, coverage: "complete" });
  });
});

describe("windowDelta", () => {
  const complete = (value: number): WindowReading => ({ value, coverage: "complete" });

  it("duas janelas completas comparam", () => {
    expect(windowDelta(complete(150), complete(100))).toEqual({ kind: "value", percent: 50 });
  });

  it("janela parcial ou desconhecida é sem base", () => {
    expect(windowDelta(complete(100), { value: 20, coverage: "partial" })).toEqual({ kind: "no_base" });
    expect(windowDelta({ value: 20, coverage: "partial" }, complete(100))).toEqual({ kind: "no_base" });
    expect(windowDelta(complete(100), { value: 20, coverage: "unknown" })).toEqual({ kind: "no_base" });
  });
});

describe("observedCount", () => {
  const END = "2026-11-05T03:00:00.000Z";

  it("valor positivo sempre aparece", () => {
    expect(observedCount(3, null, END)).toBe(3);
  });

  it("0 só vale com observação anterior ao fim do recorte", () => {
    expect(observedCount(0, span("2026-11-01T00:00:00Z"), END)).toBe(0);
    expect(observedCount(0, span("2026-11-06T00:00:00Z"), END)).toBeNull();
    expect(observedCount(0, span(null), END)).toBeNull();
    expect(observedCount(0, undefined, END)).toBeNull();
  });

  it("isObservedBy exige first antes do fim", () => {
    expect(isObservedBy(span(END), END)).toBe(false);
    expect(isObservedBy(span("2026-11-05T02:59:59Z"), END)).toBe(true);
  });
});
