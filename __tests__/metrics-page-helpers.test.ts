import { describe, expect, it } from "vitest";
import { failureCount, readCombinedWindow, sumNullable, type EventKind, type Sources } from "@/lib/metrics/daily";
import { runStatusLabel, stepStatusLabel } from "@/lib/metrics/failures";
import { sumBuckets } from "@/lib/metrics/flow";
import { mostlyFailed, resultData, type RpcResult } from "@/lib/metrics/rpc";

const OK: RpcResult<number> = { status: "ok", data: 1 };
const MISSING: RpcResult<number> = { status: "missing" };

describe("resultData", () => {
  it("devolve o dado só quando a chamada deu certo", () => {
    expect(resultData(OK)).toBe(1);
    expect(resultData(MISSING)).toBeNull();
  });
});

describe("mostlyFailed", () => {
  it("exige mais da metade das fontes sem dado", () => {
    expect(mostlyFailed([OK, MISSING])).toBe(false);
    expect(mostlyFailed([OK, MISSING, MISSING])).toBe(true);
    expect(mostlyFailed([OK, OK])).toBe(false);
  });
});

describe("sumNullable e failureCount", () => {
  it("só é nulo quando nenhum lado tem dado", () => {
    expect(sumNullable(null, null)).toBeNull();
    expect(sumNullable(2, null)).toBe(2);
    expect(sumNullable(null, 3)).toBe(3);
    expect(sumNullable(2, 3)).toBe(5);
  });

  it("soma falhas de execução e de mensagem", () => {
    const values = { failure_run: 2, failure_message: null } as Record<EventKind, number | null>;
    expect(failureCount(values)).toBe(2);
    expect(failureCount({ ...values, failure_run: null })).toBeNull();
  });
});

describe("readCombinedWindow", () => {
  const span = { first: "2026-01-01T00:00:00Z", last: "2026-01-02T00:00:00Z" };
  const sources: Sources = { comments: span, messages_inbound: span, messages_outbound: span, runs: span, posts: span };
  const WINDOW = { startIso: "2026-01-20T00:00:00Z", endIso: "2026-02-01T00:00:00Z" };

  it("soma as fontes e trata ausência depois da primeira observação como 0", () => {
    expect(readCombinedWindow(["failure_run", "failure_message"], { failure_run: 4 }, WINDOW, sources)).toEqual({ value: 4, coverage: "complete" });
  });

  it("fonte parcial marca a soma, fonte nunca observada não pesa", () => {
    const partial = { ...sources, messages_outbound: { first: "2026-01-25T00:00:00Z", last: null } };
    expect(readCombinedWindow(["failure_run", "failure_message"], { failure_run: 4 }, WINDOW, partial)).toEqual({ value: 4, coverage: "partial" });
    const never = { ...sources, messages_outbound: { first: null, last: null } };
    expect(readCombinedWindow(["failure_run", "failure_message"], { failure_run: 4 }, WINDOW, never)).toEqual({ value: 4, coverage: "complete" });
  });

  it("sem resultado da janela não inventa zero", () => {
    expect(readCombinedWindow(["failure_run", "failure_message"], null, WINDOW, sources)).toEqual({ value: null, coverage: "unknown" });
  });
});

describe("sumBuckets", () => {
  it("soma cada coluna", () => {
    const bucket = { inbound: 2, inbound_clicks: 1, outbound_automation: 3, outbound_manual: 4 };
    expect(sumBuckets([bucket, bucket])).toEqual({ inbound: 4, inbound_clicks: 2, outbound_automation: 6, outbound_manual: 8 });
    expect(sumBuckets([])).toEqual({ inbound: 0, inbound_clicks: 0, outbound_automation: 0, outbound_manual: 0 });
  });
});

describe("rótulos de status", () => {
  it("traduz os estados do schema e não expõe valor desconhecido", () => {
    expect(runStatusLabel("failed")).toBe("Falhou");
    expect(stepStatusLabel("succeeded")).toBe("concluída");
    expect(runStatusLabel("constructor")).toBe("Outro estado");
    expect(stepStatusLabel("xyz")).toBe("outro estado");
  });
});
