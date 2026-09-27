import { normalizeChannelParam } from "./repo";

export type ChannelParamDecision =
  | { action: "redirect"; channelId: string }
  | { action: "use"; channelId: string | null; source: "url" | "conversation" };

/**
 * Decisão pura (sem I/O) de qual channel o Inbox deve usar quando existe uma
 * `conversation` selecionada — regra da Fase D1 (docs/PITCHAT_ARCHITECTURE.md
 * §13): a conversation sempre vence sobre um `channel` diferente na URL, e a
 * URL é canonicalizada; sem `channel` na URL, a visão continua "Todos os
 * canais" (não adiciona o param sozinho).
 */
export function resolveConversationChannelParam(
  rawChannel: string | string[] | undefined | null,
  conversationSocialAccountId: string | null
): ChannelParamDecision {
  const normalized = normalizeChannelParam(rawChannel);

  if (conversationSocialAccountId && normalized !== null && normalized !== conversationSocialAccountId) {
    return { action: "redirect", channelId: conversationSocialAccountId };
  }

  if (conversationSocialAccountId && normalized === conversationSocialAccountId) {
    // Já veio da própria conversation — sabemos que o social_account existe
    // (é o dela), não precisa de outra validação de "canal não encontrado".
    return { action: "use", channelId: normalized, source: "conversation" };
  }

  return { action: "use", channelId: normalized, source: "url" };
}
