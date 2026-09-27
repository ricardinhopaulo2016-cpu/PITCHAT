import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { listContacts } from "@/lib/contacts/repo";
import { normalizeChannelParam, resolveChannel } from "@/lib/channel/repo";
import { withoutChannelParam } from "@/lib/channel/url";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ContactRow } from "@/components/contacts/contact-row";

export const dynamic = "force-dynamic";

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const { channel: rawChannel } = await searchParams;

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  // `?channel=all` é o valor legado de "todos os canais" — canonicaliza pra
  // ausência do param (D1, seção 2).
  if (rawChannel === "all") redirect("/dashboard/contacts");

  const channelId = normalizeChannelParam(rawChannel);
  const channel = channelId ? await resolveChannel(admin, auth.workspace.id, channelId) : null;

  if (channelId && !channel) {
    return (
      <>
        <PageHeader title="Contacts" description="Pessoas que já interagiram com uma conta Instagram conectada." />
        <div className="px-6 pb-10 md:px-8">
          <EmptyState
            title="Canal não encontrado ou não está mais conectado."
            description="A conta selecionada não existe mais neste workspace, ou foi desconectada. Nenhum dado foi ampliado pra outro canal automaticamente."
            action={
              <Link
                href="/dashboard/contacts"
                className="inline-flex h-9 items-center justify-center rounded-[var(--radius-button)] bg-signal px-3.5 text-sm font-medium text-signal-on transition-colors duration-[var(--motion-fast)] hover:bg-signal-hover"
              >
                Ver todos os canais
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const contacts = await listContacts(admin, auth.workspace.id, { socialAccountId: channel?.id ?? null });

  // Com channel ativo, cada linha existe PORQUE tem conversation naquele
  // canal — mostrar essa conta específica (não "a mais recente entre todas")
  // é mais honesto sobre por que o contato apareceu na lista filtrada.
  const rows = channel ? contacts.map((c) => ({ ...c, socialAccountUsername: channel.username })) : contacts;

  return (
    <>
      <PageHeader
        title="Contacts"
        description={channel ? `Contatos com conversa em @${channel.username ?? "conta"}.` : "Pessoas que já interagiram com uma conta Instagram conectada."}
      />

      {rows.length === 0 ? (
        <div className="px-6 pb-10 md:px-8">
          <EmptyState
            title="Nenhum contato ainda"
            description={
              channel
                ? "Ninguém interagiu com esta conta ainda."
                : "Contatos aparecem aqui assim que alguém comentar ou mandar DM."
            }
            action={
              channel && (
                <Link href={withoutChannelParam("/dashboard/contacts", {})} className="text-sm text-text-secondary hover:text-text">
                  Ver todos os canais
                </Link>
              )
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-border-subtle border-y border-border-subtle pb-0" aria-label="Contatos">
          {rows.map((c) => (
            <li key={c.id}>
              <ContactRow contact={c} channelId={channel?.id ?? null} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
