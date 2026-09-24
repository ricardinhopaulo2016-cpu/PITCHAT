import { describe, expect, it } from "vitest";
import { decideWebhookEventOutcome } from "@/lib/meta/webhook-outcome";

describe("decideWebhookEventOutcome", () => {
  it("todos os eventos casaram uma social_account -> processed, sem last_error", () => {
    const outcome = decideWebhookEventOutcome([
      { matched: true, eventType: "InstagramCommentReceived", externalAccountId: "acc1" },
      { matched: true, eventType: "InstagramQuickReplyReceived", externalAccountId: "acc1" },
    ]);
    expect(outcome).toEqual({ status: "processed", lastError: null });
  });

  it("nenhum evento -> processed (payload vazio não é uma falha)", () => {
    expect(decideWebhookEventOutcome([])).toEqual({ status: "processed", lastError: null });
  });

  // Regressão do achado real 24/09/2026: antes disso, um evento sem
  // social_account correspondente terminava marcado "processed" sem
  // nenhum erro visível — foi exatamente esse tipo de gap (ID da conta
  // gravado errado no OAuth) que custou tempo real de investigação nesta
  // sessão. Nunca mais "processed" silencioso.
  it("um evento sem social_account correspondente -> failed, com SOCIAL_ACCOUNT_NOT_FOUND explícito", () => {
    const outcome = decideWebhookEventOutcome(
      [{ matched: false, eventType: "InstagramCommentReceived", externalAccountId: "conta-desconhecida" }],
      () => "2026-09-24T12:00:00.000Z"
    );
    expect(outcome).toEqual({
      status: "failed",
      lastError: {
        reason: "SOCIAL_ACCOUNT_NOT_FOUND",
        timestamp: "2026-09-24T12:00:00.000Z",
        details: [{ eventType: "InstagramCommentReceived", externalAccountId: "conta-desconhecida" }],
      },
    });
  });

  it("payload misto (um evento casou, outro não) -> failed no geral, lista só os que não casaram", () => {
    const outcome = decideWebhookEventOutcome([
      { matched: true, eventType: "InstagramCommentReceived", externalAccountId: "acc-ok" },
      { matched: false, eventType: "InstagramCommentReceived", externalAccountId: "acc-desconhecida" },
    ]);
    expect(outcome.status).toBe("failed");
    expect(outcome.lastError?.details).toEqual([
      { eventType: "InstagramCommentReceived", externalAccountId: "acc-desconhecida" },
    ]);
  });

  it("nunca inclui token/payload sensível no last_error — só eventType e externalAccountId", () => {
    const outcome = decideWebhookEventOutcome([
      { matched: false, eventType: "InstagramCommentReceived", externalAccountId: "acc1" },
    ]);
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toMatch(/token/i);
    expect(serialized).not.toMatch(/access_token_encrypted/i);
  });
});
