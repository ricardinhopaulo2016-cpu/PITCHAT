import Link from "next/link";
import type { ConversationListItem } from "@/lib/inbox/repo";
import { buildInboxHref, type InboxFilter } from "@/lib/inbox/url";
import { AccountTile } from "@/components/ui/account-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { UnreadBadge } from "@/components/ui/unread-badge";
import { platformLabel, timeAgo } from "@/lib/ui/format";

type ListContext = {
  /** Channel Filter ativo (D1) — preservado em cada link pra abrir a thread sem sair do canal escolhido. */
  channelId?: string | null;
  filter: InboxFilter;
  page: number;
};

/**
 * Coluna 1 do Inbox. Cada linha responde "quem, o que, quando, por qual
 * conta, precisa de atenção?". Selecionada = Signal Rail de 2px à esquerda
 * (não só background). Não lida = bolinha com número + nome em negrito +
 * texto pra leitor de tela; manual = marker de espera + palavra — nunca só cor.
 *
 * Todo link daqui leva `conversation` ou pode levar: `prefetch={false}` é
 * obrigatório, senão o prefetch abriria a conversa no servidor e a marcaria
 * como lida sem ninguém ter clicado.
 */
export function ConversationList({
  conversations,
  selectedId,
  channelId,
  filter,
  page,
  hasMore,
  unreadTotal,
}: {
  conversations: ConversationListItem[];
  selectedId?: string;
  channelId?: string | null;
  filter: InboxFilter;
  page: number;
  hasMore: boolean;
  /** Conversas com não lidas no canal atual, em todas as páginas. */
  unreadTotal: number;
}) {
  const context: ListContext = { channelId, filter, page };

  return (
    <>
      <FilterTabs context={context} selectedId={selectedId} unreadTotal={unreadTotal} />

      {conversations.length === 0 ? (
        <div className="p-6">
          <EmptyListState filter={filter} page={page} />
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle" aria-label="Conversas">
          {conversations.map((c) => (
            <li key={c.id}>
              <ConversationRow conversation={c} selected={c.id === selectedId} context={context} />
            </li>
          ))}
        </ul>
      )}

      <Pagination context={context} selectedId={selectedId} hasMore={hasMore} />
    </>
  );
}

function EmptyListState({ filter, page }: { filter: InboxFilter; page: number }) {
  if (page > 1) {
    return <EmptyState title="Nada nesta página" description="As conversas mudaram de posição. Volte para as mais recentes." />;
  }
  if (filter === "unread") {
    return <EmptyState title="Nenhuma conversa não lida" description="Quando alguém comentar ou mandar mensagem, a conversa aparece aqui." />;
  }
  return <EmptyState title="Nenhuma conversa ainda" description="Assim que alguém comentar ou mandar DM pra uma conta conectada, a conversa aparece aqui." />;
}

function FilterTabs({ context, selectedId, unreadTotal }: { context: ListContext; selectedId?: string; unreadTotal: number }) {
  const tab = "inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-button)] px-2.5 text-sm font-medium transition-colors duration-[var(--motion-fast)]";
  const active = "bg-surface-3 text-text";
  const idle = "text-text-secondary hover:text-text";
  const href = (filter: InboxFilter) => buildInboxHref({ channelId: context.channelId, filter, conversationId: selectedId });

  return (
    <nav aria-label="Filtrar conversas" className="sticky top-0 z-10 flex shrink-0 items-center gap-1 border-b border-border-subtle bg-bg px-4 py-2">
      <Link
        href={href("all")}
        prefetch={false}
        aria-current={context.filter === "all" ? "true" : undefined}
        className={`${tab} ${context.filter === "all" ? active : idle}`}
      >
        Todas
      </Link>
      <Link
        href={href("unread")}
        prefetch={false}
        aria-current={context.filter === "unread" ? "true" : undefined}
        className={`${tab} ${context.filter === "unread" ? active : idle}`}
      >
        Não lidas
        <UnreadBadge count={unreadTotal} label={`${unreadTotal} ${unreadTotal === 1 ? "conversa não lida" : "conversas não lidas"}`} />
      </Link>
    </nav>
  );
}

function Pagination({ context, selectedId, hasMore }: { context: ListContext; selectedId?: string; hasMore: boolean }) {
  if (context.page <= 1 && !hasMore) return null;
  const href = (page: number) => buildInboxHref({ channelId: context.channelId, filter: context.filter, page, conversationId: selectedId });
  const link = "text-sm font-medium text-text-secondary hover:text-text";

  return (
    <nav aria-label="Páginas de conversas" className="flex shrink-0 items-center justify-between gap-3 border-t border-border-subtle px-5 py-3">
      {context.page > 1 ? (
        <Link href={href(context.page - 1)} prefetch={false} className={link}>
          Mais recentes
        </Link>
      ) : (
        <span />
      )}
      <span className="text-xs text-text-muted">Página {context.page}</span>
      {hasMore ? (
        <Link href={href(context.page + 1)} prefetch={false} className={link}>
          Mais antigas
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

function ConversationRow({
  conversation: c,
  selected,
  context,
}: {
  conversation: ConversationListItem;
  selected: boolean;
  context: ListContext;
}) {
  const name = c.contactUsername ? `@${c.contactUsername}` : "Contato";
  const account = c.socialAccountUsername ? `No @${c.socialAccountUsername}` : platformLabel(c.platform);
  const href = buildInboxHref({ channelId: context.channelId, filter: context.filter, page: context.page, conversationId: c.id });

  return (
    <Link
      href={href}
      prefetch={false}
      aria-current={selected ? "true" : undefined}
      className={`flex gap-3 px-5 py-3.5 transition-colors duration-[var(--motion-fast)] hover:bg-surface-1 ${selected ? "bg-surface-2" : ""}`}
    >
      <AccountTile username={c.socialAccountUsername} size="lg" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm text-text ${c.unread ? "font-bold" : "font-medium"}`}>{name}</span>
          <span className="shrink-0 text-xs text-text-muted">{timeAgo(c.previewAt)}</span>
        </div>

        <div className="mt-0.5 flex items-center justify-between gap-2">
          <p className={`min-w-0 truncate text-sm ${c.unread ? "font-medium text-text" : "text-text-secondary"}`}>
            {c.previewText ?? "Sem mensagens ainda"}
          </p>
          <UnreadBadge count={c.unreadCount} label={`${c.unreadCount} ${c.unreadCount === 1 ? "mensagem não lida" : "mensagens não lidas"}.`} />
        </div>

        <div className="mt-1 flex items-center justify-between gap-2 text-xs text-text-muted">
          <span className="truncate">{account}</span>
          {!c.automationEnabled && (
            <span className="inline-flex shrink-0 items-center gap-1 text-warning">
              Manual
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
