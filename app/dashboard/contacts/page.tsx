import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { CONTACTS_PAGE_SIZE, countContacts, listContacts } from "@/lib/contacts/repo";
import { normalizeChannelParam, resolveChannel } from "@/lib/channel/repo";
import { withoutChannelParam } from "@/lib/channel/url";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ContactRow } from "@/components/contacts/contact-row";
import { ContactSearch } from "@/components/contacts/contact-search";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { formatRange, parseRange, rangeToIso } from "@/lib/ui/date-range";

export const dynamic = "force-dynamic";

const number = new Intl.NumberFormat("pt-BR");

export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ channel?: string; q?: string; de?: string; ate?: string; pagina?: string }> }) {
  const { channel: rawChannel, q, de, ate, pagina } = await searchParams;
  const page = Math.max(0, (Number.parseInt(pagina ?? "1", 10) || 1) - 1);
  const search = q?.trim() ?? "";
  const range = parseRange(de, ate);

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
        <PageHeader title="Contatos" description="Pessoas que já interagiram com uma conta Instagram conectada." />
        <div className="px-6 pb-10 md:px-11">
          <EmptyState
            title="Canal não encontrado ou não está mais conectado."
            description="A conta selecionada não existe mais neste workspace, ou foi desconectada. Nenhum dado foi ampliado pra outro canal automaticamente."
            action={
              <Link
                href="/dashboard/contacts"
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius-button)] bg-signal px-3.5 text-sm font-medium text-signal-on transition-colors duration-[var(--motion-fast)] hover:bg-signal-hover"
              >
                Ver todos os canais
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const filters = { socialAccountId: channel?.id ?? null, search, firstSeen: range ? rangeToIso(range) : null };
  const [contacts, total] = await Promise.all([listContacts(admin, auth.workspace.id, { ...filters, page }), countContacts(admin, auth.workspace.id, filters)]);
  const lastPage = Math.max(0, Math.ceil(total / CONTACTS_PAGE_SIZE) - 1);
  const pageHref = (target: number) => {
    const params = new URLSearchParams();
    if (rawChannel) params.set("channel", rawChannel);
    if (search) params.set("q", search);
    if (range) {
      params.set("de", range.from);
      params.set("ate", range.to);
    }
    if (target > 0) params.set("pagina", String(target + 1));
    const qs = params.toString();
    return qs ? `/dashboard/contacts?${qs}` : "/dashboard/contacts";
  };

  // Com channel ativo, cada linha existe PORQUE tem conversation naquele
  // canal — mostrar essa conta específica (não "a mais recente entre todas")
  // é mais honesto sobre por que o contato apareceu na lista filtrada.
  const rows = channel ? contacts.map((c) => ({ ...c, socialAccountUsername: channel.username })) : contacts;

  return (
    <>
      <PageHeader
        title="Contatos"
        description={channel ? `Contatos com conversa em @${channel.username ?? "conta"}.` : "Pessoas que já interagiram com uma conta Instagram conectada."}
      />

      <div className="flex flex-wrap items-center gap-3 px-6 pb-5 md:px-11">
        <ContactSearch />
        <DateRangeFilter emptyLabel="Primeiro contato: sempre" />
        {total > 0 && (
          <p className="ml-auto text-sm text-text-secondary">
            {number.format(total)} {total === 1 ? "contato" : "contatos"}
            {range && ` em ${formatRange(range)}`}
          </p>
        )}
      </div>

      {rows.length === 0 && (search || range) ? (
        <div className="px-6 pb-10 md:px-11">
          <EmptyState title="Nenhum contato encontrado" description="Mude a busca ou o período." />
        </div>
      ) : rows.length === 0 ? (
        <div className="px-6 pb-10 md:px-11">
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
        <div className="px-6 pb-14 md:px-11">
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1" aria-label="Contatos">
            {rows.map((c) => (
              <li key={c.id}>
                <ContactRow contact={c} channelId={channel?.id ?? null} />
              </li>
            ))}
          </ul>
          {lastPage > 0 && (
            <nav aria-label="Páginas" className="mt-4 flex items-center justify-between gap-3">
              {page > 0 ? (
                <Link href={pageHref(page - 1)} className="inline-flex h-11 items-center rounded-[var(--radius-button)] border border-border px-4 font-medium text-text hover:border-border-strong">
                  Anterior
                </Link>
              ) : (
                <span />
              )}
              <span className="text-sm tabular-nums text-text-muted">
                Página {page + 1} de {lastPage + 1}
              </span>
              {page < lastPage ? (
                <Link href={pageHref(page + 1)} className="inline-flex h-11 items-center rounded-[var(--radius-button)] border border-border px-4 font-medium text-text hover:border-border-strong">
                  Próxima
                </Link>
              ) : (
                <span />
              )}
            </nav>
          )}
        </div>
      )}
    </>
  );
}
