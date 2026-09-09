import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyMetaWebhookSignature } from "@/lib/meta/signature";

const SECRET = "test-app-secret";

function sign(body: string, secret = SECRET): string {
  return "sha256=" + createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describe("verifyMetaWebhookSignature", () => {
  it("aceita uma assinatura válida", () => {
    const body = '{"object":"instagram","entry":[]}';
    expect(verifyMetaWebhookSignature(body, sign(body), SECRET)).toBe(true);
  });

  it("rejeita quando o corpo foi alterado depois de assinado", () => {
    const body = '{"object":"instagram"}';
    const tampered = '{"object":"instagram","extra":"injetado"}';
    expect(verifyMetaWebhookSignature(tampered, sign(body), SECRET)).toBe(false);
  });

  it("rejeita assinatura feita com o secret errado", () => {
    const body = '{"object":"instagram"}';
    expect(verifyMetaWebhookSignature(body, sign(body, "secret-errado"), SECRET)).toBe(false);
  });

  it("rejeita quando não tem header nenhum", () => {
    expect(verifyMetaWebhookSignature("{}", null, SECRET)).toBe(false);
  });

  it("rejeita header sem o prefixo sha256=", () => {
    const body = "{}";
    const rawHex = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyMetaWebhookSignature(body, rawHex, SECRET)).toBe(false);
  });

  it("rejeita assinatura de tamanho errado sem lançar exceção", () => {
    expect(verifyMetaWebhookSignature("{}", "sha256=abc123", SECRET)).toBe(false);
  });
});
