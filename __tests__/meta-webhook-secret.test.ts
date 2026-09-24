import { afterEach, describe, expect, it } from "vitest";
import { getWebhookSigningSecret } from "@/lib/meta/webhook-secret";

describe("getWebhookSigningSecret", () => {
  const originalInstagramSecret = process.env.INSTAGRAM_APP_SECRET;
  const originalMetaSecret = process.env.META_APP_SECRET;

  afterEach(() => {
    if (originalInstagramSecret === undefined) delete process.env.INSTAGRAM_APP_SECRET;
    else process.env.INSTAGRAM_APP_SECRET = originalInstagramSecret;

    if (originalMetaSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = originalMetaSecret;
  });

  // Regressão do achado real 24/09/2026, confirmado byte a byte contra
  // entregas reais da Meta: o webhook do "Instagram API with Instagram
  // Login" é assinado com INSTAGRAM_APP_SECRET, NUNCA com META_APP_SECRET —
  // esse último nunca validou nenhuma entrega desde o início do projeto,
  // mesmo idêntico ao valor real do App Dashboard. Nunca reverter essa
  // escolha sem um novo teste real contra produção.
  it("usa INSTAGRAM_APP_SECRET, nunca META_APP_SECRET, mesmo com os dois definidos e diferentes", () => {
    process.env.INSTAGRAM_APP_SECRET = "instagram-app-secret-real";
    process.env.META_APP_SECRET = "meta-app-secret-principal-nunca-usar-aqui";

    const result = getWebhookSigningSecret();

    expect(result).toBe("instagram-app-secret-real");
    expect(result).not.toBe(process.env.META_APP_SECRET);
  });

  it("retorna undefined se INSTAGRAM_APP_SECRET não estiver configurado, mesmo com META_APP_SECRET presente", () => {
    delete process.env.INSTAGRAM_APP_SECRET;
    process.env.META_APP_SECRET = "meta-app-secret-principal";

    expect(getWebhookSigningSecret()).toBeUndefined();
  });

  it("reflete mudança de env em runtime (não é module-level const preso ao import)", () => {
    process.env.INSTAGRAM_APP_SECRET = "valor-1";
    expect(getWebhookSigningSecret()).toBe("valor-1");
    process.env.INSTAGRAM_APP_SECRET = "valor-2";
    expect(getWebhookSigningSecret()).toBe("valor-2");
  });
});
