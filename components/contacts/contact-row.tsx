import Link from "next/link";
import type { ContactListItem } from "@/lib/contacts/repo";
import { ContactAvatar } from "./contact-avatar";
import { platformLabel, timeAgo } from "@/lib/ui/format";

const TAGS_SHOWN = 3;

/** Linha de contato — lista operacional, sem card gigante: hairline, hover e foco no padrão Signal Desk. */
export function ContactRow({ contact: c, channelId }: { contact: ContactListItem; channelId?: string | null }) {
  const name = c.username ? `@${c.username}` : c.id.slice(0, 8);
  const where = c.socialAccountUsername ? `${platformLabel(c.platform)} · @${c.socialAccountUsername}` : `${platformLabel(c.platform)} · sem conversa ainda`;
  const extraTags = c.tags.length - TAGS_SHOWN;
  // Preserva o Channel Filter ativo ao abrir o Contact Detail (D1).
  const href = channelId ? `/dashboard/contacts/${c.id}?channel=${channelId}` : `/dashboard/contacts/${c.id}`;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 transition-colors duration-[var(--motion-fast)] hover:bg-surface-1 md:px-5"
    >
      <ContactAvatar username={c.username} avatarUrl={c.avatarUrl} />

      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{name}</p>
        <p className="truncate text-xs text-text-muted">{where}</p>
      </div>

      {c.tags.length > 0 && (
        <ul className="hidden shrink-0 items-center gap-1.5 md:flex" aria-label="Tags">
          {c.tags.slice(0, TAGS_SHOWN).map((t) => (
            <li key={t} className="rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[11px] text-text-secondary">
              {t}
            </li>
          ))}
          {extraTags > 0 && <li className="text-[11px] text-text-muted">+{extraTags}</li>}
        </ul>
      )}

      <span className="w-14 shrink-0 text-right text-xs text-text-muted" title="Última atividade">
        {timeAgo(c.lastSeenAt)}
      </span>
    </Link>
  );
}
