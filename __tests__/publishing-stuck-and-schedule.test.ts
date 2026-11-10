import { describe, expect, it } from "vitest";
import { isStaleUpload, isStuckProcessing } from "@/lib/publishing/stuck";
import { addMinutesLocal, distributeSchedule } from "@/lib/publishing/batch-schedule";

const NOW = new Date("2026-11-10T20:00:00Z");

describe("post travado e envio abandonado", () => {
  it("post em Publicando há mais de 30 min do horário está travado", () => {
    expect(isStuckProcessing({ status: "processing", scheduled_at: "2026-11-10T19:20:00Z" }, NOW)).toBe(true);
    expect(isStuckProcessing({ status: "processing", scheduled_at: "2026-11-10T19:45:00Z" }, NOW)).toBe(false);
  });

  it("só post em Publicando conta como travado", () => {
    expect(isStuckProcessing({ status: "scheduled", scheduled_at: "2026-11-09T19:00:00Z" }, NOW)).toBe(false);
    expect(isStuckProcessing({ status: "failed", scheduled_at: "2026-11-09T19:00:00Z" }, NOW)).toBe(false);
  });

  it("mídia pendente há mais de 1 hora é envio que não terminou", () => {
    expect(isStaleUpload({ status: "pending", created_at: "2026-11-10T18:30:00Z" }, NOW)).toBe(true);
    expect(isStaleUpload({ status: "processing", created_at: "2026-11-10T19:30:00Z" }, NOW)).toBe(false);
    expect(isStaleUpload({ status: "ready", created_at: "2026-11-01T00:00:00Z" }, NOW)).toBe(false);
  });
});

describe("horários do lote", () => {
  it("soma minutos mantendo o formato do campo de data", () => {
    expect(addMinutesLocal("2026-11-12T23:30", 60)).toBe("2026-11-13T00:30");
    expect(addMinutesLocal("lixo", 60)).toBe("lixo");
  });

  it("contas diferentes começam juntas; na mesma conta o intervalo espaça", () => {
    const rows = [{ accountId: "pit" }, { accountId: "dodo" }, { accountId: "pit" }, { accountId: "pit" }];
    expect(distributeSchedule(rows, "2026-11-12T08:00", 120)).toEqual([
      "2026-11-12T08:00",
      "2026-11-12T08:00",
      "2026-11-12T10:00",
      "2026-11-12T12:00",
    ]);
  });
});
