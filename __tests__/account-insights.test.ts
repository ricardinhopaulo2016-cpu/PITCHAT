import { describe, expect, it } from "vitest";
import { accountLacksInsights } from "@/lib/social-accounts/repo";

describe("accountLacksInsights", () => {
  it("conta conectada sem a permissão de métricas precisa reconectar", () => {
    expect(accountLacksInsights({ status: "connected", permissions: ["instagram_business_basic"] })).toBe(true);
    expect(accountLacksInsights({ status: "connected", permissions: null })).toBe(true);
  });

  it("conta com a permissão não pede nada", () => {
    expect(accountLacksInsights({ status: "connected", permissions: ["instagram_business_manage_insights"] })).toBe(false);
  });

  it("conta desconectada já pede reconexão pelo status, não por métricas", () => {
    expect(accountLacksInsights({ status: "expired", permissions: [] })).toBe(false);
  });
});
