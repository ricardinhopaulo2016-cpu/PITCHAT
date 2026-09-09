import { describe, expect, it } from "vitest";
import { sanitizeDeduplicationId } from "@/lib/qstash";

describe("sanitizeDeduplicationId", () => {
  it("troca ':' por '-' — QStash rejeita ':' (descoberto contra a API real em 09/09/2026)", () => {
    expect(sanitizeDeduplicationId("delay:run-1:node-1")).toBe("delay-run-1-node-1");
    expect(sanitizeDeduplicationId("webhook-event:abc-123")).toBe("webhook-event-abc-123");
  });

  it("mantém letras, números, hífen e underscore intactos", () => {
    expect(sanitizeDeduplicationId("abc_123-XYZ")).toBe("abc_123-XYZ");
  });

  it("troca qualquer outro caractere especial, não só ':'", () => {
    expect(sanitizeDeduplicationId("a:b/c d.e")).toBe("a-b-c-d-e");
  });
});
