import { describe, expect, it } from "vitest";
import { bucketTotal, buildQueueState, findPeak, formatPeakHour, hourOfDayProfile, hourStats, type HourBucket, type RawQueue } from "@/lib/metrics/flow";

const hour = (h: string, inbound: number, automation = 0, manual = 0): HourBucket => ({
  hour: h,
  inbound,
  inbound_clicks: 0,
  outbound_automation: automation,
  outbound_manual: manual,
});
const NOW = "2026-11-08T12:00:00.000Z";
const queue = (partial: Partial<RawQueue>): RawQueue => ({
  queued_count: 0,
  queued_oldest_at: null,
  waiting_delay: 0,
  waiting_retry: 0,
  waiting_oldest_at: null,
  waiting_quick_reply: 0,
  ...partial,
});

describe("bucketTotal", () => {
  it("cliques já estão em inbound e não somam de novo", () => {
    expect(bucketTotal({ inbound: 5, inbound_clicks: 3, outbound_automation: 2, outbound_manual: 1 })).toBe(8);
  });
});

describe("findPeak", () => {
  it("acha o maior total", () => {
    expect(findPeak([hour("2026-11-01T10", 1), hour("2026-11-01T11", 5, 2)])).toEqual({ hour: "2026-11-01T11", total: 7 });
  });

  it("empate fica com o mais antigo, em qualquer ordem", () => {
    expect(findPeak([hour("2026-11-02T10", 4), hour("2026-11-01T10", 4)])?.hour).toBe("2026-11-01T10");
    expect(findPeak([hour("2026-11-01T10", 4), hour("2026-11-02T10", 4)])?.hour).toBe("2026-11-01T10");
  });

  it("bucket 0 não é pico", () => {
    expect(findPeak([hour("2026-11-01T10", 0)])).toBeNull();
    expect(findPeak([])).toBeNull();
  });
});

describe("hourOfDayProfile", () => {
  it("sempre devolve 24 horas", () => {
    expect(hourOfDayProfile([])).toHaveLength(24);
    expect(hourOfDayProfile([]).map((p) => p.hourOfDay)).toEqual(Array.from({ length: 24 }, (_, i) => i));
  });

  it("soma a mesma hora de dias diferentes", () => {
    const profile = hourOfDayProfile([hour("2026-11-01T14", 2, 1), hour("2026-11-02T14", 3, 0, 4)]);
    expect(profile[14]).toMatchObject({ inbound: 5, outbound_automation: 1, outbound_manual: 4 });
    expect(profile[13].inbound).toBe(0);
  });
});

describe("hourStats e formatPeakHour", () => {
  it("média só das horas com mensagem", () => {
    expect(hourStats([hour("2026-11-01T10", 4), hour("2026-11-01T11", 0), hour("2026-11-01T12", 2)])).toEqual({ activeHours: 2, averageHourly: 3 });
  });

  it("sem mensagem não há média", () => {
    expect(hourStats([])).toEqual({ activeHours: 0, averageHourly: null });
  });

  it("formata dia e hora", () => {
    expect(formatPeakHour("2026-11-08T14")).toBe("08/11 às 14h");
  });
});

describe("buildQueueState", () => {
  it("queued_count 0 vira not_recorded", () => {
    expect(buildQueueState(queue({}), NOW).messageQueue).toEqual({ kind: "not_recorded" });
  });

  it("mostra a idade da fila", () => {
    const state = buildQueueState(queue({ queued_count: 3, queued_oldest_at: "2026-11-08T11:45:30.000Z" }), NOW);
    expect(state.messageQueue).toEqual({ kind: "active", count: 3, oldestMinutes: 14 });
  });

  it("execuções em espera e clique da pessoa", () => {
    const state = buildQueueState(queue({ waiting_delay: 2, waiting_retry: 1, waiting_oldest_at: "2026-11-08T11:00:00+00:00", waiting_quick_reply: 9 }), NOW);
    expect(state.runs).toEqual({ delay: 2, retry: 1, oldestMinutes: 60 });
    expect(state.awaitingPerson).toBe(9);
  });

  it("sem espera a idade é null, não 0", () => {
    expect(buildQueueState(queue({}), NOW).runs.oldestMinutes).toBeNull();
  });
});
