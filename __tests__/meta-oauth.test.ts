import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthorizationUrl, buildOAuthState, needsRefresh, verifyOAuthState } from "@/lib/meta/oauth";

const config = {
  appId: "990602627938098",
  appSecret: "secret",
  redirectUri: "https://pitchat.exemplo.com/api/auth/meta/callback",
};

describe("buildAuthorizationUrl", () => {
  it("monta a URL com os scopes atuais (prefixo instagram_business_*, nunca os legados)", () => {
    const url = new URL(buildAuthorizationUrl(config, "state123"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe(config.appId);
    expect(url.searchParams.get("redirect_uri")).toBe(config.redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("state123");

    const scopes = url.searchParams.get("scope")!.split(",");
    expect(scopes).toEqual([
      "instagram_business_basic",
      "instagram_business_manage_messages",
      "instagram_business_manage_comments",
    ]);
    // nunca os scopes legados descontinuados em 27/01/2025
    expect(scopes.some((s) => !s.startsWith("instagram_business_"))).toBe(false);
  });
});

describe("buildOAuthState / verifyOAuthState", () => {
  const secret = "app-secret-de-teste";

  it("faz round-trip: state gerado é aceito de volta com os mesmos IDs", () => {
    const state = buildOAuthState("ws1", "profile1", secret);
    expect(verifyOAuthState(state, secret)).toEqual({ workspaceId: "ws1", profileId: "profile1" });
  });

  it("rejeita state assinado com secret diferente (forjado)", () => {
    const state = buildOAuthState("ws1", "profile1", secret);
    expect(verifyOAuthState(state, "outro-secret")).toBeNull();
  });

  it("rejeita state adulterado (payload alterado depois de assinado)", () => {
    const state = buildOAuthState("ws1", "profile1", secret);
    const [, signature] = state.split(".");
    const tamperedPayload = Buffer.from(JSON.stringify({ workspaceId: "ws-invasor", profileId: "profile1", nonce: "x", ts: Date.now() })).toString("base64url");
    expect(verifyOAuthState(`${tamperedPayload}.${signature}`, secret)).toBeNull();
  });

  it("rejeita state malformado sem lançar exceção", () => {
    expect(verifyOAuthState("nao-tem-ponto", secret)).toBeNull();
    expect(verifyOAuthState("", secret)).toBeNull();
  });

  it("rejeita state expirado (mais de 10 min)", () => {
    const oldPayload = Buffer.from(
      JSON.stringify({ workspaceId: "ws1", profileId: "p1", nonce: "x", ts: Date.now() - 11 * 60 * 1000 })
    ).toString("base64url");
    const sig = createHmac("sha256", secret).update(oldPayload).digest("base64url");
    expect(verifyOAuthState(`${oldPayload}.${sig}`, secret)).toBeNull();
  });
});

describe("needsRefresh", () => {
  it("precisa renovar quando falta menos que o threshold", () => {
    const in5Days = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    expect(needsRefresh(in5Days, 10)).toBe(true);
  });

  it("não precisa renovar quando ainda falta bastante tempo", () => {
    const in50Days = new Date(Date.now() + 50 * 24 * 60 * 60 * 1000);
    expect(needsRefresh(in50Days, 10)).toBe(false);
  });

  it("já expirado sempre precisa renovar (embora nesse ponto renovação pode falhar de verdade)", () => {
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(needsRefresh(yesterday, 10)).toBe(true);
  });
});
