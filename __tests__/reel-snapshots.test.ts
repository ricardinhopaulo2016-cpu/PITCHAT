import { describe, expect, it } from "vitest";
import { dueSnapshotAges, parseReelInsights, snapshotDelaysSeconds } from "@/lib/insights/reel-snapshots";

const PUBLISHED = "2026-11-10T12:00:00Z";
const at = (hours: number) => new Date(new Date(PUBLISHED).getTime() + hours * 3600_000);

describe("fotos de métricas dos Reels", () => {
  it("lê a resposta real da Graph API", () => {
    const json = {
      data: [
        { name: "views", values: [{ value: 8 }] },
        { name: "reach", values: [{ value: 7 }] },
        { name: "ig_reels_avg_watch_time", values: [{ value: 24991 }] },
        { name: "likes", values: [{ value: "x" }] },
      ],
    };
    expect(parseReelInsights(json)).toMatchObject({ views: 8, reach: 7, avg_watch_time_ms: 24991, likes: null, shares: null });
    expect(parseReelInsights(null).views).toBeNull();
  });

  it("agenda as 7 idades, de 1 hora a 7 dias", () => {
    expect(snapshotDelaysSeconds().map((s) => s.age)).toEqual([1, 3, 6, 24, 48, 72, 168]);
    expect(snapshotDelaysSeconds()[0].delaySeconds).toBe(3600);
  });

  it("a reserva pega a idade vencida dentro da tolerância e sem foto", () => {
    expect(dueSnapshotAges(PUBLISHED, at(26), new Set())).toEqual([24]);
    expect(dueSnapshotAges(PUBLISHED, at(26), new Set([24]))).toEqual([]);
  });

  it("foto atrasada demais não vale para aquela idade", () => {
    // 1h tirada 20h depois não serve para comparar ritmo.
    expect(dueSnapshotAges(PUBLISHED, at(20), new Set())).toEqual([]);
    // 7 dias aceita até 42h de atraso: o cron diário sempre alcança.
    expect(dueSnapshotAges(PUBLISHED, at(168 + 30), new Set())).toEqual([168]);
  });
});
