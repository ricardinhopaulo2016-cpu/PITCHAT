import Link from "next/link";
import type { ConversationListItem } from "@/lib/inbox/repo";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { EmptyState } from "@/components/ui/empty-state";
import { SignalMarker } from "@/components/icons/pitchat";
import { platformLabel, timeAgo } from "@/lib/ui/format";

/**
 * Coluna 1 do Inbox. Cada linha responde "quem, o que, quando, por qual
 * conta, precisa de atenção?". Selecionada = Signal Rail de 2px à esquerda
 * (não só background). Não lida = ponto + nome em negrito + texto pra leitor
 * de tela; manual = marker de espera + palavra — nunca só cor.
 */
export function ConversationList({ conversations, selectedId }: { conversations: ConversationListItem[]; selectedId?: string }) {
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
          <ConversationRow conversation={c} selected={c.id === selectedId} />
        </li>
      ))}
    </ul>
  );
}

function ConversationRow({ conversation: c, selected }: { conversation: ConversationListItem; selected: boolean }) {
  const name = c.contactUsername ? `@${c.contactUsername}` : "Contato";
  const account = c.socialAccountUsername ? `${platformLabel(c.platform)} · @${c.socialAccountUsername}` : platformLabel(c.platform);

  return (
    <Link
      href={`/dashboard/inbox?conversation=${c.id}`}
      aria-current={selected ? "true" : undefined}
      className={`relative flex gap-3 px-4 py-3 transition-colors duration-[var(--motion-fast)] hover:bg-surface-1 ${selected ? "bg-surface-1" : ""}`}
    >
      {selected && <span aria-hidden="true" className="absolute bottom-3 left-0 top-3 w-[2px] rounded-full bg-signal" />}

      <ContactAvatar username={c.contactUsername} avatarUrl={c.contactAvatarUrl} />

      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`truncate text-sm text-text ${c.unread ? "font-semibold" : "font-medium"}`}>{name}</span>
          <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-text-muted">
            {c.unread && (
              <>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-signal" />
                <span className="sr-only">Não lida.</span>
              </>
            )}
            {timeAgo(c.previewAt)}
          </span>
        </div>

        <p className={`mt-0.5 truncate text-[13px] ${c.unread ? "text-text-secondary" : "text-text-muted"}`}>
          {c.previewText ?? "Sem mensagens ainda"}
        </p>

        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-text-muted">
          <span className="truncate">{account}</span>
          {!c.automationEnabled && (
            <span className="inline-flex shrink-0 items-center gap-1 text-warning">
              <SignalMarker type="wait" width={9} height={9} /> Manual
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
