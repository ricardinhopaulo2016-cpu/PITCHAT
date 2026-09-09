import { describe, expect, it } from "vitest";
import { classifyMetaError } from "@/lib/meta/client";

describe("classifyMetaError", () => {
  it("trata códigos de rate limit (4, 17, 32, 613) como retryable, mesmo com status HTTP não-óbvio", () => {
    expect(classifyMetaError(200, 4)).toBe("RETRYABLE");
    expect(classifyMetaError(400, 17)).toBe("RETRYABLE");
    expect(classifyMetaError(403, 32)).toBe("RETRYABLE");
    expect(classifyMetaError(400, 613)).toBe("RETRYABLE");
  });

  it("trata token expirado/inválido (190) como non-retryable — nunca adianta tentar de novo sem reautenticar", () => {
    expect(classifyMetaError(401, 190)).toBe("NON_RETRYABLE");
  });

  it("cai pro status HTTP quando não tem código de erro reconhecido", () => {
    expect(classifyMetaError(429)).toBe("RETRYABLE");
    expect(classifyMetaError(503)).toBe("RETRYABLE");
    expect(classifyMetaError(400)).toBe("NON_RETRYABLE");
    expect(classifyMetaError(422, 999)).toBe("NON_RETRYABLE");
  });
});
