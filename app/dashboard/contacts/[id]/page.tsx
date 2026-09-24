import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadContactDetail } from "@/lib/contacts/repo";
import { SignalMarker } from "@/components/icons/pitchat";

export const dynamic = "force-dynamic";

export default async function ContactDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const contact = await loadContactDetail(admin, id, auth.workspace.id);
  if (!contact) notFound();

  return (
    <div className="px-6 pb-10 pt-7 md:px-8 md:pt-8">
      <Link href="/dashboard/contacts" className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text">
        <ChevronLeft className="h-3.5 w-3.5" /> Contacts
      </Link>

      <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-text">
        {contact.username ? `@${contact.username}` : contact.id.slice(0, 8)}
      </h1>
      <p className="mt-1 text-sm text-text-secondary">{contact.platform}</p>

      <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
        <div className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-5">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-text-muted">Dados</p>
          <dl className="flex flex-col gap-3 text-sm">
            <div>
              <dt className="text-xs text-text-muted">Primeira vez visto</dt>
              <dd className="text-text">{new Date(contact.firstSeenAt).toLocaleString("pt-BR")}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-muted">Última vez visto</dt>
              <dd className="text-text">{new Date(contact.lastSeenAt).toLocaleString("pt-BR")}</dd>
            </div>
          </dl>

          <p className="mb-2 mt-5 text-[11px] font-medium uppercase tracking-wide text-text-muted">Tags</p>
          {contact.tags.length === 0 ? (
            <p className="text-xs text-text-muted">Nenhuma tag.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {contact.tags.map((t) => (
                <span key={t} className="rounded-full border border-border-subtle bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">
                  {t}
                </span>
              ))}
            </div>
          )}

          {contact.customFields.length > 0 && (
            <>
              <p className="mb-2 mt-5 text-[11px] font-medium uppercase tracking-wide text-text-muted">Custom fields</p>
              <dl className="flex flex-col gap-2 text-sm">
                {contact.customFields.map((f) => (
                  <div key={f.key}>
                    <dt className="text-xs text-text-muted">{f.label}</dt>
                    <dd className="text-text">{String(f.value)}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>

        <div className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-5">
          <p className="mb-3 text-[11px] font-medium uppercase tracking-wide text-text-muted">Conversas</p>
          {contact.conversations.length === 0 ? (
            <p className="text-xs text-text-muted">Nenhuma conversa ainda.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {contact.conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/inbox?conversation=${c.id}`}
                    className="flex items-center justify-between gap-3 rounded-[var(--radius-panel-sm)] px-2.5 py-2 text-sm hover:bg-surface-2"
                  >
                    <span className="text-text">{c.socialAccountUsername ? `@${c.socialAccountUsername}` : "Conversa"}</span>
                    <span className="flex items-center gap-3 text-xs text-text-muted">
                      {!c.automationEnabled && (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <SignalMarker type="wait" width={9} height={9} /> manual
                        </span>
                      )}
                      {c.lastMessageAt && new Date(c.lastMessageAt).toLocaleDateString("pt-BR")}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
