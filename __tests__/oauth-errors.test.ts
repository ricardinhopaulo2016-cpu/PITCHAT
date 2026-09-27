import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exchangeForLongLivedToken, buildOAuthState } from "@/lib/meta/oauth";
import { InstagramOAuthError, redactSecrets, toSafeErrorDetail } from "@/lib/meta/oauth-errors";

/**
 * Investigação do HTTP 400 no exchange pra long-lived token (D0): a Meta
 * respondia com um body explicativo que o código descartava. Estes testes
 * garantem (a) o diagnóstico estruturado e (b) que nenhuma credencial vaza
 * pro erro, pro log ou pra URL.
 */

const SECRET = "app-secret-super-secreto-123456";
const SHORT_TOKEN = "IGAAshortLivedTokenAbCdEfGhIjKlMnOpQrStUvWxYz0123456789";
const OAUTH_CODE = "AQBcodeDoOauthQueNuncaPodeVazar_1234567890";
const config = { instagramAppId: "123", instagramAppSecret: SECRET, redirectUri: "https://app.test/api/auth/meta/callback" };

function jsonResponse(status: number, body: unknown) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
}

async function captureExchangeError(res: Response): Promise<InstagramOAuthError> {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
  try {
    await exchangeForLongLivedToken(config, SHORT_TOKEN);
  } catch (e) {
    return e as InstagramOAuthError;
  }
  throw new Error("era esperado lançar");
}

afterEach(() => vi.unstubAllGlobals());

describe("exchangeForLongLivedToken — erro estruturado", () => {
  it("HTTP 400 com body da Meta preserva status/code/subcode/type/message/fbtrace_id", async () => {
    const err = await captureExchangeError(
      jsonResponse(400, {
        error: { message: "Invalid scope for this operation", type: "OAuthException", code: 100, error_subcode: 2207052, fbtrace_id: "AbCdEf123" },
      })
    );
    expect(err).toBeInstanceOf(InstagramOAuthError);
    expect(err.operation).toBe("instagram_long_lived_token_exchange");
    expect(err.httpStatus).toBe(400);
    expect(err.metaCode).toBe(100);
    expect(err.metaSubcode).toBe(2207052);
    expect(err.metaType).toBe("OAuthException");
    expect(err.fbtraceId).toBe("AbCdEf123");
    expect(err.safeMessage).toBe("Invalid scope for this operation");
    expect(err.message).toContain("HTTP 400");
    expect(err.message).toContain("code 100");
    expect(err.message).toContain("subcode 2207052");
  });

  it("formato legado (error_type/code/error_message) também é entendido", async () => {
    const err = await captureExchangeError(jsonResponse(400, { error_type: "OAuthException", code: 400, error_message: "Bad request" }));
    expect(err).toMatchObject({ httpStatus: 400, metaCode: 400, metaType: "OAuthException", safeMessage: "Bad request" });
  });

  it("body não-JSON (HTML) ainda produz erro diagnóstico seguro, sem preservar o body", async () => {
    const err = await captureExchangeError(jsonResponse(400, "<html><body>Bad Gateway CONTEUDO-BRUTO-DO-BODY</body></html>"));
    expect(err).toBeInstanceOf(InstagramOAuthError);
    expect(err.httpStatus).toBe(400);
    expect(err.metaCode).toBeUndefined();
    expect(err.safeMessage).toBe("resposta não-JSON da Meta");
    expect(JSON.stringify(err)).not.toContain("CONTEUDO-BRUTO-DO-BODY");
    expect(err.message).not.toContain("CONTEUDO-BRUTO-DO-BODY");
  });

  it("body vazio e JSON sem `error` também não quebram", async () => {
    expect((await captureExchangeError(jsonResponse(400, ""))).safeMessage).toBe("resposta não-JSON da Meta");
    expect((await captureExchangeError(jsonResponse(400, { foo: "bar" }))).safeMessage).toBe("resposta de erro da Meta sem mensagem");
  });

  it("segredos/tokens fornecidos ao exchange NÃO aparecem no erro serializado, mesmo se a Meta os ecoar", async () => {
    const err = await captureExchangeError(
      jsonResponse(400, {
        error: {
          message: `Invalid token ${SHORT_TOKEN} for secret ${SECRET} at https://graph.instagram.com/access_token?access_token=${SHORT_TOKEN}&client_secret=${SECRET}`,
          type: "OAuthException",
          code: 190,
        },
      })
    );
    const everything = [err.message, err.safeMessage, String(err), JSON.stringify(err), err.stack ?? ""].join("\n");
    expect(everything).not.toContain(SHORT_TOKEN);
    expect(everything).not.toContain(SECRET);
    expect(everything).not.toContain("access_token=");
    expect(everything).not.toContain("graph.instagram.com/access_token");
    expect(err.metaCode).toBe(190); // o diagnóstico útil continua
  });

  it("a request nunca vai parar no erro (URL com token fica fora)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(400, { error: { message: "x", code: 100 } }));
    vi.stubGlobal("fetch", fetchMock);
    const err = await exchangeForLongLivedToken(config, SHORT_TOKEN).catch((e) => e as InstagramOAuthError);
    expect(fetchMock.mock.calls[0][0]).toContain(SHORT_TOKEN); // a request real usa o token...
    expect(JSON.stringify(err)).not.toContain(SHORT_TOKEN); // ...o erro não.
  });
});

describe("redactSecrets / toSafeErrorDetail", () => {
  it("redige valores conhecidos, pares token=, URLs e strings opacas longas", () => {
    const out = redactSecrets(`falha ${SECRET} code=${OAUTH_CODE} em https://x.test/?a=b ${"A".repeat(50)}`, [SECRET]);
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(OAUTH_CODE);
    expect(out).not.toContain("https://");
    expect(out).not.toContain("A".repeat(50));
  });

  it("detail da URL é só um identificador categorizado", () => {
    const err = new InstagramOAuthError({
      operation: "instagram_long_lived_token_exchange",
      httpStatus: 400,
      metaCode: 100,
      metaSubcode: 33,
      safeMessage: "mensagem técnica qualquer com espaços e (símbolos)",
    });
    const detail = toSafeErrorDetail(err);
    expect(detail).toBe("long_lived_exchange_failed_http400_code100_sub33");
    expect(detail).toMatch(/^[a-z0-9_]+$/);
    expect(toSafeErrorDetail(new Error("Falha ao trocar code por token: HTTP 400"))).toBe("short_lived_exchange_failed");
    expect(toSafeErrorDetail(new Error("qualquer coisa com token=abc"))).toBe("unexpected_error");
  });
});

/**
 * Callback ponta a ponta (com fetch e Supabase mockados): a falha do exchange
 * vira redirect com detail categorizado, log estruturado sem credenciais e
 * NENHUM efeito colateral (a decisão/assinatura/escrita do D0 vêm depois).
 */
describe("callback do OAuth — falha no exchange long-lived", () => {
  const fromSpy = vi.fn();
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  beforeEach(() => {
    process.env.INSTAGRAM_APP_ID = "123";
    process.env.INSTAGRAM_APP_SECRET = SECRET;
    process.env.META_REDIRECT_URI = "https://app.test/api/auth/meta/callback";
    fromSpy.mockClear();
    errorSpy.mockClear();
    vi.resetModules();
    vi.doMock("@/lib/supabase/admin", () => ({ getSupabaseAdminClient: () => ({ from: fromSpy }) }));
  });

  afterEach(() => {
    vi.doUnmock("@/lib/supabase/admin");
  });

  it("não coloca a mensagem técnica na URL, loga só campos seguros e não toca no banco", async () => {
    const techMessage = `Invalid OAuth access token ${SHORT_TOKEN} MENSAGEM-TECNICA-DA-META`;
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        // 1) troca do code por token curto — ok
        .mockResolvedValueOnce(jsonResponse(200, { access_token: SHORT_TOKEN, user_id: "app-scoped", permissions: ["instagram_business_basic"] }))
        // 2) exchange long-lived — falha real da Meta
        .mockResolvedValueOnce(jsonResponse(400, { error: { message: techMessage, type: "OAuthException", code: 100, error_subcode: 33 } }))
    );

    const { GET } = await import("@/app/api/auth/meta/callback/route");
    const state = buildOAuthState("ws-1", "profile-1", SECRET);
    const res = await GET(new Request(`https://app.test/api/auth/meta/callback?code=${OAUTH_CODE}&state=${encodeURIComponent(state)}`));

    const location = res.headers.get("location") ?? "";
    const url = new URL(location);
    expect(url.pathname).toBe("/dashboard/social-accounts");
    expect(url.searchParams.get("status")).toBe("error");
    expect(url.searchParams.get("detail")).toBe("long_lived_exchange_failed_http400_code100_sub33");
    for (const forbidden of [SHORT_TOKEN, SECRET, OAUTH_CODE, "MENSAGEM-TECNICA-DA-META", "Invalid OAuth"]) {
      expect(location).not.toContain(forbidden);
    }

    // log server-side: diagnóstico completo, sem credenciais
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged = String(errorSpy.mock.calls[0][0]);
    const parsed = JSON.parse(logged);
    expect(parsed).toMatchObject({
      event: "oauth_callback_failed",
      operation: "instagram_long_lived_token_exchange",
      httpStatus: 400,
      metaCode: 100,
      metaSubcode: 33,
      metaType: "OAuthException",
    });
    expect(parsed.message).toContain("MENSAGEM-TECNICA-DA-META");
    for (const forbidden of [SHORT_TOKEN, SECRET, OAUTH_CODE]) {
      expect(logged).not.toContain(forbidden);
    }

    // D0: falhou antes da decisão de link → nenhuma leitura/escrita em social_accounts, nenhuma assinatura de webhook
    expect(fromSpy).not.toHaveBeenCalled();
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
  });
});
