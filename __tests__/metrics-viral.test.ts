import { describe, expect, it } from "vitest";
import { buildGoalPosts, buildViralAccounts, matureBeforeIso } from "@/lib/metrics/viral";

const account = (mature_reels: number) => ({ social_account_id: "acc", username: "perfil", mature_reels });

describe("buildViralAccounts", () => {
  it("29 reels fica insufficient", () => {
    const [row] = buildViralAccounts([account(29)]);
    expect(row.status).toBe("insufficient");
    expect(row.progress).toBeCloseTo(29 / 30);
    expect(row.target).toBe(30);
  });

  it("30 reels fica waiting_real_time", () => {
    const [row] = buildViralAccounts([account(30)]);
    expect(row.status).toBe("waiting_real_time");
    expect(row.progress).toBe(1);
  });

  it("progresso limitado a 1", () => {
    expect(buildViralAccounts([account(90)])[0].progress).toBe(1);
  });

  it("nenhum retorno traz chave de chance ou porcentagem", () => {
    const keys = Object.keys(buildViralAccounts([account(40)])[0]).join(" ");
    expect(keys).not.toMatch(/chance|probab|percent|score/i);
  });
});

describe("buildGoalPosts", () => {
  const post = (requests_unique: number) => ({ social_account_id: "acc", external_media_id: "m1", requests_unique, permalink: null });

  it("calcula o progresso até 1.000", () => {
    expect(buildGoalPosts([post(250)])[0]).toEqual({ accountId: "acc", mediaId: "m1", permalink: null, requests: 250, progress: 0.25 });
  });

  it("acima de 1.000 limita a 1 e mantém o número real", () => {
    const [row] = buildGoalPosts([post(1500)]);
    expect(row.progress).toBe(1);
    expect(row.requests).toBe(1500);
  });
});

describe("matureBeforeIso", () => {
  it("é 7 dias antes", () => {
    expect(matureBeforeIso(new Date("2026-11-08T12:00:00.000Z"))).toBe("2026-11-01T12:00:00.000Z");
  });
});
