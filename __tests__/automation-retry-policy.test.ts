import { describe, expect, it } from "vitest";
import { getRetryBackoffMinutes, MAX_RETRY_ATTEMPTS } from "@/lib/automation/retry-policy";

describe("getRetryBackoffMinutes", () => {
  it("primeira, segunda e terceira tentativa têm backoff crescente", () => {
    expect(getRetryBackoffMinutes(1)).toBe(1);
    expect(getRetryBackoffMinutes(2)).toBe(5);
    expect(getRetryBackoffMinutes(3)).toBe(15);
  });

  it("depois de MAX_RETRY_ATTEMPTS, retorna null — a run falha de vez, nunca tenta pra sempre", () => {
    expect(getRetryBackoffMinutes(MAX_RETRY_ATTEMPTS + 1)).toBeNull();
    expect(getRetryBackoffMinutes(99)).toBeNull();
  });

  it("attemptNumber inválido (0 ou negativo) nunca lança, retorna null", () => {
    expect(getRetryBackoffMinutes(0)).toBeNull();
    expect(getRetryBackoffMinutes(-1)).toBeNull();
  });

  it("MAX_RETRY_ATTEMPTS bate com o tamanho real da tabela de backoff", () => {
    expect(MAX_RETRY_ATTEMPTS).toBe(3);
  });
});
