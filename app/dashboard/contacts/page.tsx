import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { listContacts } from "@/lib/contacts/repo";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ContactRow } from "@/components/contacts/contact-row";

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

      {contacts.length === 0 ? (
        <div className="px-6 pb-10 md:px-8">
          <EmptyState title="Nenhum contato ainda" description="Contatos aparecem aqui assim que alguém comentar ou mandar DM." />
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle border-y border-border-subtle pb-0" aria-label="Contatos">
          {contacts.map((c) => (
            <li key={c.id}>
              <ContactRow contact={c} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
