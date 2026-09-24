import { describe, expect, it } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import { classifyRefreshFailure, outcomeRequiresReconnect } from "@/lib/meta/token-maintenance";

describe("classifyRefreshFailure", () => {
  it("erro RETRYABLE (rate limit, 5xx) vira refresh_retryable_failure — nunca desconecta a conta", () => {
    const err = new MetaApiError("rate limited", { kind: "RETRYABLE", code: 4, httpStatus: 400 });
    expect(classifyRefreshFailure(err)).toBe("refresh_retryable_failure");
  });

  it("código 190 (OAuthException — token inválido/revogado) vira reauth_required", () => {
    const err = new MetaApiError("token expired", { kind: "NON_RETRYABLE", code: 190, httpStatus: 401 });
    expect(classifyRefreshFailure(err)).toBe("reauth_required");
  });

  it("NON_RETRYABLE sem ser código 190 vira refresh_non_retryable_failure (definitivo, mas não especificamente reauth)", () => {
    const err = new MetaApiError("bad request", { kind: "NON_RETRYABLE", code: 100, httpStatus: 400 });
    expect(classifyRefreshFailure(err)).toBe("refresh_non_retryable_failure");
  });

  // Nunca desconectar uma conta por causa de um erro que a gente não sabe
  // classificar (rede, timeout, DNS) — trata como transitório por padrão.
  it("erro desconhecido (não é MetaApiError, ex: falha de rede) vira refresh_retryable_failure", () => {
    expect(classifyRefreshFailure(new Error("fetch failed"))).toBe("refresh_retryable_failure");
    expect(classifyRefreshFailure("string qualquer")).toBe("refresh_retryable_failure");
    expect(classifyRefreshFailure(undefined)).toBe("refresh_retryable_failure");
  });
});

describe("outcomeRequiresReconnect", () => {
  it("reauth_required e refresh_non_retryable_failure exigem reconexão", () => {
    expect(outcomeRequiresReconnect("reauth_required")).toBe(true);
    expect(outcomeRequiresReconnect("refresh_non_retryable_failure")).toBe(true);
  });

  it("refresh_retryable_failure NUNCA exige reconexão — é transitório, tenta de novo amanhã", () => {
    expect(outcomeRequiresReconnect("refresh_retryable_failure")).toBe(false);
  });
});
