import { afterEach, describe, expect, it, vi } from "vitest";
import { formatClock, formatDateTimeLong, formatLastActivity } from "@/lib/ui/format";

describe("lib/ui/format — datas em America/Sao_Paulo", () => {
  afterEach(() => vi.useRealTimers());

  it("converte UTC pro horário de Brasília (UTC-3), independente do fuso do servidor", () => {
    expect(formatClock("2026-09-26T19:36:00.000Z")).toBe("16:36");
  });

  it("formata `26 set 2026 · 16:36` sem o ponto do mês abreviado", () => {
    expect(formatDateTimeLong("2026-09-26T19:36:00.000Z")).toBe("26 set 2026 · 16:36");
  });

  it("prefixa 'há Nh' na última atividade", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T23:36:00.000Z"));
    expect(formatLastActivity("2026-09-26T19:36:00.000Z")).toBe("há 4h · 26 set 2026 · 16:36");
  });

  it("usa 'agora' quando < 1 min", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T19:36:20.000Z"));
    expect(formatLastActivity("2026-09-26T19:36:00.000Z")).toBe("agora · 26 set 2026 · 16:36");
  });

  it("dia muda no fuso de SP, não em UTC (02:00 UTC do dia 27 ainda é dia 26 à noite)", () => {
    expect(formatDateTimeLong("2026-09-27T02:00:00.000Z")).toBe("26 set 2026 · 23:00");
  });
});
