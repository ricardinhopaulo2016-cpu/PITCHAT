import { describe, expect, it } from "vitest";
import { checkUrlAllowed } from "@/lib/automation/ssrf-guard";

describe("checkUrlAllowed", () => {
  it("permite URL https pública normal", () => {
    expect(checkUrlAllowed("https://api.exemplo.com/webhook")).toEqual({ allowed: true });
  });

  it("bloqueia localhost", () => {
    expect(checkUrlAllowed("http://localhost:3000/admin").allowed).toBe(false);
  });

  it("bloqueia 127.0.0.1", () => {
    expect(checkUrlAllowed("http://127.0.0.1/secret").allowed).toBe(false);
  });

  it("bloqueia ranges privados (10.x, 172.16-31.x, 192.168.x)", () => {
    expect(checkUrlAllowed("http://10.0.0.5/").allowed).toBe(false);
    expect(checkUrlAllowed("http://172.16.0.1/").allowed).toBe(false);
    expect(checkUrlAllowed("http://172.31.255.255/").allowed).toBe(false);
    expect(checkUrlAllowed("http://192.168.1.1/").allowed).toBe(false);
    // fora do range 172.16-31 deve passar (172.32 não é privado)
    expect(checkUrlAllowed("https://172.32.0.1/").allowed).toBe(true);
  });

  it("bloqueia endpoint de metadata cloud (169.254.x)", () => {
    expect(checkUrlAllowed("http://169.254.169.254/latest/meta-data/").allowed).toBe(false);
  });

  it("bloqueia domínios .local e .internal", () => {
    expect(checkUrlAllowed("http://minha-maquina.local/").allowed).toBe(false);
    expect(checkUrlAllowed("http://api.internal/").allowed).toBe(false);
  });

  it("bloqueia protocolos que não são http/https", () => {
    expect(checkUrlAllowed("file:///etc/passwd").allowed).toBe(false);
    expect(checkUrlAllowed("ftp://exemplo.com/").allowed).toBe(false);
  });

  it("bloqueia URL inválida sem lançar exceção", () => {
    expect(checkUrlAllowed("nao-e-uma-url").allowed).toBe(false);
  });

  it("bloqueia IPv6 loopback", () => {
    expect(checkUrlAllowed("http://[::1]/").allowed).toBe(false);
  });
});
