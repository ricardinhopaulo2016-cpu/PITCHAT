import type { ReactNode } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadContactDetail } from "@/lib/contacts/repo";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { SignalMarker } from "@/components/icons/pitchat";
import { formatDateTimeLong, formatLastActivity, platformLabel, timeAgo } from "@/lib/ui/format";
import { buildHref } from "@/lib/channel/url";

export const dynamic = "force-dynamic";

/** Seção editorial: título à esquerda (sm+), conteúdo colado à direita — sem espaço morto entre label e valor. */
function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-x-8 gap-y-3 border-t border-border-subtle py-5 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <h2 id={id} className="text-[13px] font-medium text-text-secondary sm:pt-0.5">
        {title}
      </h2>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm text-text">{children}</dd>
    </div>
  );
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ channel?: string }>;
}) {
  const { id } = await params;
  const { channel: channelParam } = await searchParams;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const contact = await loadContactDetail(admin, id, auth.workspace.id);
  if (!contact) notFound();

  const name = contact.username ? `@${contact.username}` : contact.id.slice(0, 8);
  // Preserva o Channel Filter que trouxe até aqui (D1) — "Contacts" volta pra
  // mesma visão filtrada, nunca amplia o escopo sozinho.
  const backHref = buildHref("/dashboard/contacts", channelParam ? { channel: channelParam } : {});

  return (
    <div className="max-w-2xl px-6 pb-10 pt-7 md:px-8 md:pt-8">
      <Link href={backHref} className="mb-5 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text">
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> Contacts
      </Link>

      <header className="flex items-center gap-4 pb-5">
        <ContactAvatar username={contact.username} avatarUrl={contact.avatarUrl} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-[26px] font-semibold tracking-[-0.025em] text-text">{name}</h1>
          <p className="mt-0.5 text-sm text-text-secondary">
            {platformLabel(contact.platform)} · última atividade há {timeAgo(contact.lastSeenAt)}
          </p>
        </div>
      </header>

      <Section id="contact-identity" title="Identidade">
        <dl className="flex flex-col gap-3">
          <Field label="Username">{contact.username ? `@${contact.username}` : "—"}</Field>
          <Field label="Plataforma">{platformLabel(contact.platform)}</Field>
          <Field label="Primeira interação">{formatDateTimeLong(contact.firstSeenAt)}</Field>
          <Field label="Última atividade">{formatLastActivity(contact.lastSeenAt)}</Field>
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
          <dl className="flex flex-col gap-3">
            {contact.customFields.map((f) => (
              <Field key={f.key} label={f.label}>
                {String(f.value)}
              </Field>
            ))}
          </dl>
        </Section>
      )}

      <Section id="contact-conversations" title="Conversas">
        {contact.conversations.length === 0 ? (
          <p className="text-sm text-text-muted">Nenhuma conversa ainda.</p>
        ) : (
          <ul className="-mt-1 divide-y divide-border-subtle border-y border-border-subtle">
            {contact.conversations.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/dashboard/inbox?channel=${c.socialAccountId}&conversation=${c.id}`}
                  className="group flex items-center justify-between gap-3 px-2 py-3 transition-colors duration-[var(--motion-fast)] hover:bg-surface-1"
                >
                  <span className="min-w-0">
                    <span className="block text-xs text-text-muted">{platformLabel(contact.platform)}</span>
                    <span className="block truncate text-sm font-medium text-text">
                      {c.socialAccountUsername ? `@${c.socialAccountUsername}` : "Conversa"}
                    </span>
                    <span className="block text-xs text-text-muted">
                      {c.lastMessageAt ? `Última atividade ${timeAgo(c.lastMessageAt)}` : "Sem mensagens ainda"}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-3 text-xs">
                    {!c.automationEnabled && (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <SignalMarker type="wait" width={9} height={9} /> Operação manual
                      </span>
                    )}
                    <ChevronRight
                      className="h-4 w-4 text-text-muted transition-colors duration-[var(--motion-fast)] group-hover:text-text"
                      aria-hidden="true"
                    />
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
