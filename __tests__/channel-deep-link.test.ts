import { describe, expect, it } from "vitest";
import { resolveConversationChannelParam } from "@/lib/channel/deep-link";

/**
 * D1 — regra de deep link do Inbox (docs/PITCHAT_ARCHITECTURE.md §13):
 * conversation válida SEMPRE vence sobre um `channel` diferente na URL, e
 * sem `channel` a visão continua "Todos os canais" (nunca adiciona sozinho).
 */
describe("resolveConversationChannelParam", () => {
  it("sem conversation e sem channel → todos os canais", () => {
    expect(resolveConversationChannelParam(undefined, null)).toEqual({ action: "use", channelId: null, source: "url" });
  });

  it("sem conversation, channel presente → usa o channel da URL (validação real é assunto de resolveChannel)", () => {
    expect(resolveConversationChannelParam("sa-1", null)).toEqual({ action: "use", channelId: "sa-1", source: "url" });
  });

  it("?channel=all é tratado como ausência de channel", () => {
    expect(resolveConversationChannelParam("all", null)).toEqual({ action: "use", channelId: null, source: "url" });
  });

  it("conversation válida + SEM channel → mantém 'Todos os canais', não adiciona o param sozinho", () => {
    expect(resolveConversationChannelParam(undefined, "sa-conv")).toEqual({ action: "use", channelId: null, source: "url" });
  });

  it("conversation válida + channel IGUAL à conta da conversation → usa, sem redirect", () => {
    expect(resolveConversationChannelParam("sa-conv", "sa-conv")).toEqual({ action: "use", channelId: "sa-conv", source: "conversation" });
  });

  it("conversation válida + channel DIFERENTE → a conversation vence, canonicaliza pro channel dela", () => {
    expect(resolveConversationChannelParam("sa-outro", "sa-conv")).toEqual({ action: "redirect", channelId: "sa-conv" });
  });
});
