import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadContactDetail } from "@/lib/contacts/repo";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { SignalMarker } from "@/components/icons/pitchat";
import { formatDate, formatDateTime, platformLabel, timeAgo } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="border-t border-border-subtle py-6">
      <h2 id={id} className="mb-3 text-[15px] font-semibold text-text">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const contact = await loadContactDetail(admin, id, auth.workspace.id);
  if (!contact) notFound();

  const name = contact.username ? `@${contact.username}` : contact.id.slice(0, 8);

  return (
    <div className="max-w-3xl px-6 pb-10 pt-7 md:px-8 md:pt-8">
      <Link href="/dashboard/contacts" className="mb-5 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text">
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Contacts
      </Link>

      <header className="flex items-center gap-4 pb-6">
        <ContactAvatar username={contact.username} avatarUrl={contact.avatarUrl} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold tracking-[-0.025em] text-text">{name}</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            {platformLabel(contact.platform)} · última atividade {timeAgo(contact.lastSeenAt)}
          </p>
        </div>
      </header>

      <Section id="contact-identity" title="Identidade">
        <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-xs text-text-muted">Username</dt>
            <dd className="text-text">{contact.username ? `@${contact.username}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Plataforma</dt>
            <dd className="text-text">{platformLabel(contact.platform)}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Primeira vez visto</dt>
            <dd className="text-text">{formatDateTime(contact.firstSeenAt)}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Última atividade</dt>
            <dd className="text-text">{formatDateTime(contact.lastSeenAt)}</dd>
          </div>
        </dl>
      </Section>

      <Section id="contact-tags" title="Tags">
        {contact.tags.length === 0 ? (
          <p className="text-sm text-text-muted">Nenhuma tag.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {contact.tags.map((t) => (
              <li key={t} className="rounded-full border border-border-subtle bg-surface-1 px-2.5 py-0.5 text-xs text-text-secondary">
                {t}
              </li>
            ))}
          </ul>
        )}
      </Section>

      {contact.customFields.length > 0 && (
        <Section id="contact-fields" title="Custom fields">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
            {contact.customFields.map((f) => (
              <div key={f.key}>
                <dt className="text-xs text-text-muted">{f.label}</dt>
                <dd className="text-text">{String(f.value)}</dd>
              </div>
            ))}
          </dl>
        </Section>
      )}

      <Section id="contact-conversations" title="Conversas">
        {contact.conversations.length === 0 ? (
          <p className="text-sm text-text-muted">Nenhuma conversa ainda.</p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {contact.conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/inbox?conversation=${c.id}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--radius-panel-sm)] px-2 py-2.5 transition-colors duration-[var(--motion-fast)] hover:bg-surface-1"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-text">
                      {c.socialAccountUsername ? `Recebido por @${c.socialAccountUsername}` : "Conversa"}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {platformLabel(contact.platform)}
                      {c.lastMessageAt && ` · última mensagem ${formatDate(c.lastMessageAt)}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs">
                    {!c.automationEnabled && (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <SignalMarker type="wait" width={9} height={9} /> Operação manual
                      </span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
