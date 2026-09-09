import { beforeEach, describe, expect, it } from "vitest";
import { decryptToken, encryptToken } from "@/lib/meta/token-crypto";

describe("encryptToken / decryptToken", () => {
  beforeEach(() => {
    process.env.META_TOKEN_ENCRYPTION_KEY = "test-encryption-key-with-enough-entropy";
  });

  it("faz round-trip sem perder o valor original", () => {
    const original = "IGQVJYb2xhIGV1IHNvdSB1bSB0b2tlbiBmYWtl";
    const encrypted = encryptToken(original);
    expect(decryptToken(encrypted)).toBe(original);
  });

  it("o valor armazenado nunca contém o token em texto puro", () => {
    const original = "meu-token-super-secreto-do-instagram";
    const encrypted = encryptToken(original);
    expect(encrypted).not.toContain(original);
  });

  it("gera um IV diferente a cada chamada (dois tokens iguais não ficam com o mesmo ciphertext)", () => {
    const a = encryptToken("mesmo-token");
    const b = encryptToken("mesmo-token");
    expect(a).not.toBe(b);
    expect(decryptToken(a)).toBe("mesmo-token");
    expect(decryptToken(b)).toBe("mesmo-token");
  });

  it("detecta adulteração do ciphertext (GCM auth tag) em vez de retornar lixo silenciosamente", () => {
    const encrypted = encryptToken("token-original");
    const [iv, authTag, data] = encrypted.split(":");
    const tampered = `${iv}:${authTag}:${data.slice(0, -2)}00`;
    expect(() => decryptToken(tampered)).toThrow();
  });

  it("lança erro claro se a chave de criptografia não estiver configurada", () => {
    delete process.env.META_TOKEN_ENCRYPTION_KEY;
    expect(() => encryptToken("x")).toThrow(/META_TOKEN_ENCRYPTION_KEY/);
  });
});
