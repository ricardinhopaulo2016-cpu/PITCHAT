import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTrackedToken, isBotUserAgent, isSafeRedirectUrl, parseTrackedToken, trackedButtonUrl } from "@/lib/links/tracked-link";

const RUN = "3f2b8c1e-9a4d-4e7b-8c21-5d6e7f8a9b0c";
const SECRET = "segredo-de-teste";

describe("link rastreado do botão", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("ida e volta: o token devolve a execução e o nó", () => {
    const token = buildTrackedToken(RUN, "send-link-1", SECRET);
    expect(parseTrackedToken(token, SECRET)).toEqual({ runId: RUN, nodeId: "send-link-1" });
    expect(token.length).toBeLessThan(80);
  });

  it("assinatura errada, outro segredo ou token mexido não passam", () => {
    const token = buildTrackedToken(RUN, "n1", SECRET);
    expect(parseTrackedToken(token, "outro")).toBeNull();
    const [run, , sig] = token.split(".");
    expect(parseTrackedToken(`${run}.${Buffer.from("n2").toString("base64url")}.${sig}`, SECRET)).toBeNull();
    expect(parseTrackedToken("lixo", SECRET)).toBeNull();
  });

  it("sem endereço do app configurado, o botão leva o link original", () => {
    vi.stubEnv("PITCHAT_APP_URL", "");
    vi.stubEnv("META_TOKEN_ENCRYPTION_KEY", "k");
    expect(trackedButtonUrl(RUN, "n1", "https://aula.exemplo.com/?mp_ids=1")).toBe("https://aula.exemplo.com/?mp_ids=1");
  });

  it("configurado, o botão aponta para /r/ do PITCHAT", () => {
    vi.stubEnv("PITCHAT_APP_URL", "https://pitchat.exemplo.app/");
    vi.stubEnv("META_TOKEN_ENCRYPTION_KEY", "k");
    expect(trackedButtonUrl(RUN, "n1", "https://aula.exemplo.com")).toMatch(/^https:\/\/pitchat\.exemplo\.app\/r\/[\w-]+\.[\w-]+\.[\w-]{16}$/);
  });

  it("só redireciona para http e https", () => {
    expect(isSafeRedirectUrl("https://a.com")).toBe(true);
    expect(isSafeRedirectUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeRedirectUrl("não é url")).toBe(false);
  });

  it("prévia de link da Meta é robô; celular de verdade não é", () => {
    expect(isBotUserAgent("facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)")).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
    expect(isBotUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Instagram 350.0")).toBe(false);
  });
});
