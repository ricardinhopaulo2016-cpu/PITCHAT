import Link from "next/link";
import type { ConversationListItem } from "@/lib/inbox/repo";
import { AccountTile } from "@/components/ui/account-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { platformLabel, timeAgo } from "@/lib/ui/format";

/**
 * Coluna 1 do Inbox. Cada linha responde "quem, o que, quando, por qual
 * conta, precisa de atenção?". Selecionada = Signal Rail de 2px à esquerda
 * (não só background). Não lida = ponto + nome em negrito + texto pra leitor
 * de tela; manual = marker de espera + palavra — nunca só cor.
 */
export function ConversationList({
  conversations,
  selectedId,
  channelId,
}: {
  conversations: ConversationListItem[];
  selectedId?: string;
  /** Channel Filter ativo (D1) — preservado em cada link pra abrir a thread sem sair do canal escolhido. */
  channelId?: string | null;
}) {
  if (conversations.length === 0) {
    return (
      <div className="p-6">
        <EmptyState title="Nenhuma conversa ainda" description="Assim que alguém comentar ou mandar DM pra uma conta conectada, a conversa aparece aqui." />
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border-subtle" aria-label="Conversas">
      {conversations.map((c) => (
        <li key={c.id}>
          <ConversationRow conversation={c} selected={c.id === selectedId} channelId={channelId} />
        </li>
      ))}
    </ul>
  );
}

function ConversationRow({
  conversation: c,
  selected,
  channelId,
}: {
  conversation: ConversationListItem;
  selected: boolean;
  channelId?: string | null;
}) {
  const name = c.contactUsername ? `@${c.contactUsername}` : "Contato";
  const account = c.socialAccountUsername ? `No @${c.socialAccountUsername}` : platformLabel(c.platform);
  const href = channelId ? `/dashboard/inbox?channel=${channelId}&conversation=${c.id}` : `/dashboard/inbox?conversation=${c.id}`;

  return (
    <Link
      href={href}
      aria-current={selected ? "true" : undefined}
      className={`flex gap-3 px-5 py-3.5 transition-colors duration-[var(--motion-fast)] hover:bg-surface-1 ${selected ? "bg-surface-2" : ""}`}
    >
      <AccountTile username={c.socialAccountUsername} size="lg" />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm text-text ${c.unread ? "font-semibold" : "font-medium"}`}>{name}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-xs text-text-muted">
            {c.unread && (
              <>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal" />
                <span className="sr-only">Não lida.</span>
              </>
            )}
            {timeAgo(c.previewAt)}
          </span>
        </div>

        <p className={`mt-0.5 truncate text-sm ${c.unread ? "text-text" : "text-text-secondary"}`}>
          {c.previewText ?? "Sem mensagens ainda"}
        </p>

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
