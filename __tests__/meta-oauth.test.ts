import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildAuthorizationUrl, buildOAuthState, needsRefresh, normalizePermissions, verifyOAuthState } from "@/lib/meta/oauth";

const config = {
  instagramAppId: "1578661687080525",
  instagramAppSecret: "secret",
  redirectUri: "https://pitchat.exemplo.com/api/auth/meta/callback",
};

describe("buildAuthorizationUrl", () => {
  it("monta a URL com os scopes atuais (prefixo instagram_business_*, nunca os legados)", () => {
    const url = new URL(buildAuthorizationUrl(config, "state123"));
    expect(url.origin + url.pathname).toBe("https://www.instagram.com/oauth/authorize");
    // client_id precisa ser o Instagram App ID, NUNCA o Meta App ID principal
    // (achado real: erro "Invalid platform app" ao usar o App ID errado,
    // confirmado na doc oficial — ver comentário no topo de lib/meta/oauth.ts).
    expect(url.searchParams.get("client_id")).toBe(config.instagramAppId);
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

describe("normalizePermissions", () => {
  // Bug real de produção (10/09/2026): a API retorna array de verdade, não
  // string separada por vírgula — "e.permissions.split is not a function"
  // quebrou o callback do OAuth. Normalizado na fronteira, nunca mais espalhar
  // esse tratamento pelo caller.
  it("aceita array de strings (formato real da API)", () => {
    expect(normalizePermissions(["instagram_business_basic", "instagram_business_manage_messages"])).toEqual([
      "instagram_business_basic",
      "instagram_business_manage_messages",
    ]);
  });

  it("aceita string separada por vírgula (formato defensivo, caso a API mude ou em fixture antiga)", () => {
    expect(normalizePermissions("instagram_business_basic, instagram_business_manage_messages")).toEqual([
      "instagram_business_basic",
      "instagram_business_manage_messages",
    ]);
  });

  it("retorna [] pra undefined/null/tipo inesperado, nunca lança", () => {
    expect(normalizePermissions(undefined)).toEqual([]);
    expect(normalizePermissions(null)).toEqual([]);
    expect(normalizePermissions(42)).toEqual([]);
    expect(normalizePermissions({})).toEqual([]);
  });

  it("filtra itens não-string dentro do array, sem lançar", () => {
    expect(normalizePermissions(["instagram_business_basic", 123, null, "instagram_business_manage_comments"])).toEqual(
      ["instagram_business_basic", "instagram_business_manage_comments"]
    );
  });

  it("string vazia ou só vírgulas retorna []", () => {
    expect(normalizePermissions("")).toEqual([]);
    expect(normalizePermissions(",,")).toEqual([]);
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
