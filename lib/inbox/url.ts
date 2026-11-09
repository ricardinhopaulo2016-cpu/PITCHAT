import { buildHref } from "@/lib/channel/url";

/**
 * Estado da lista do Inbox na URL, como o Channel Filter: filtro e página
 * sobrevivem a refresh, deep link e Voltar sem cookie nem localStorage.
 */
export type InboxFilter = "all" | "unread";

const INBOX_PATH = "/dashboard/inbox";

export function parseInboxFilter(raw: string | string[] | undefined): InboxFilter {
  return raw === "unread" ? "unread" : "all";
}

/** Número de página válido, começando em 1; qualquer outra coisa vira 1. */
export function parseInboxPage(raw: string | string[] | undefined): number {
  if (typeof raw !== "string" || !/^\d{1,6}$/.test(raw)) return 1;
  return Math.max(1, Number(raw));
}

export function buildInboxHref(params: {
  channelId?: string | null;
  filter?: InboxFilter;
  page?: number;
  conversationId?: string | null;
}): string {
  return buildHref(INBOX_PATH, {
    channel: params.channelId ?? undefined,
    filter: params.filter === "unread" ? "unread" : undefined,
    page: params.page && params.page > 1 ? String(params.page) : undefined,
    conversation: params.conversationId ?? undefined,
  });
}
