import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { listContacts } from "@/lib/contacts/repo";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const contacts = await listContacts(admin, auth.workspace.id);

  return (
    <>
      <PageHeader title="Contacts" description="Pessoas que já interagiram com uma conta Instagram conectada." />

      <div className="px-6 pb-10 md:px-8">
        {contacts.length === 0 ? (
          <EmptyState title="Nenhum contato ainda" description="Contatos aparecem aqui assim que alguém comentar ou mandar DM." />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle">
            <ul className="divide-y divide-border-subtle bg-surface-1">
              {contacts.map((c) => (
                <li key={c.id}>
                  <Link href={`/dashboard/contacts/${c.id}`} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-surface-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-text">{c.username ? `@${c.username}` : c.id.slice(0, 8)}</p>
                      <p className="text-xs text-text-muted">
                        {c.platform} · {c.socialAccountUsername ? `@${c.socialAccountUsername}` : "sem conversa ainda"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.tags.slice(0, 3).map((t) => (
                        <span key={t} className="rounded-full border border-border-subtle bg-surface-2 px-2 py-0.5 text-[11px] text-text-secondary">
                          {t}
                        </span>
                      ))}
                      <span className="text-xs text-text-muted">{new Date(c.lastSeenAt).toLocaleDateString("pt-BR")}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
