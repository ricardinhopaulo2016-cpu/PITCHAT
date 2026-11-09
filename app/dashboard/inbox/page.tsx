import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  countUnreadConversations,
  listConversations,
  loadConversationForWorkspace,
  loadConversationTimeline,
  markConversationRead,
} from "@/lib/inbox/repo";
import { buildInboxHref, parseInboxFilter, parseInboxPage } from "@/lib/inbox/url";
import { resolveChannel } from "@/lib/channel/repo";
import { resolveConversationChannelParam } from "@/lib/channel/deep-link";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { ConversationList } from "@/components/inbox/conversation-list";
import { Timeline } from "@/components/inbox/timeline";
import { ContactContext, type InboxContact } from "@/components/inbox/contact-context";
import { TakeoverToggle } from "@/components/inbox/takeover-toggle";
import { MessageComposer } from "@/components/inbox/message-composer";
import { platformLabel } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ conversation?: string; channel?: string; filter?: string; page?: string }>;
}) {
  const { conversation: conversationId, channel: channelParam, filter: filterParam, page: pageParam } = await searchParams;
  const filter = parseInboxFilter(filterParam);
  const page = parseInboxPage(pageParam);

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  // Precisa saber ANTES de decidir o channel: se `conversation` for válida,
  // ela sempre vence sobre um `channel` diferente na URL (deep link — ver
  // lib/channel/deep-link.ts).
  const selectedPreliminary = conversationId ? await loadConversationForWorkspace(admin, conversationId, auth.workspace.id) : null;

  const decision = resolveConversationChannelParam(channelParam, selectedPreliminary?.social_account_id ?? null);
  if (decision.action === "redirect") {
    redirect(buildInboxHref({ channelId: decision.channelId, filter, page, conversationId }));
  }

  const channelId = decision.channelId;

  // Channel vindo da própria conversation (decision.source === "conversation")
  // não precisa de outra validação — é o social_account real dela. Só um
  // channel digitado/colado na URL (source "url") pode ser inválido/revoked.
  if (channelId && decision.source === "url") {
    const channel = await resolveChannel(admin, auth.workspace.id, channelId);
    if (!channel) {
      return (
        <>
          <PageHeader title="Caixa de entrada" description="Conversas com quem comentou ou mandou mensagem." />
          <div className="px-6 pb-10 md:px-11">
            <EmptyState
              title="Canal não encontrado ou não está mais conectado."
              description="A conta selecionada não existe mais neste workspace, ou foi desconectada. Nenhum dado foi ampliado pra outro canal automaticamente."
              action={
                <Link
                  href="/dashboard/inbox"
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
  }

  const selected = selectedPreliminary;

  // Antes da lista e da timeline: a conversa aberta já vem sem o marcador, e
  // o que for zerado aqui já está na timeline carregada logo abaixo.
  if (selected) await markConversationRead(admin, selected.id, auth.workspace.id);

  const [{ conversations, hasMore }, unreadTotal] = await Promise.all([
    listConversations(admin, auth.workspace.id, { socialAccountId: channelId, unreadOnly: filter === "unread", page }),
    countUnreadConversations(admin, auth.workspace.id, { socialAccountId: channelId }),
  ]);

  let timeline: Awaited<ReturnType<typeof loadConversationTimeline>>["timeline"] = [];
  let automationRuns: Awaited<ReturnType<typeof loadConversationTimeline>>["automationRuns"] = [];
  let contact: InboxContact | null = null;
  let tags: string[] = [];

  if (selected) {
    // Timeline, contato e tags só dependem de `selected`, nenhuma depende do
    // resultado das outras. Paraleliza (reauditoria HEAD 24/09/2026).
    const [timelineResult, { data: contactRow }, { data: contactTags }] = await Promise.all([
      loadConversationTimeline(admin, {
        conversationId: selected.id,
        contactId: selected.contact_id,
        socialAccountId: selected.social_account_id,
      }),
      admin.from("contacts").select("id, username, avatar_url, platform, first_seen_at, last_seen_at").eq("id", selected.contact_id).maybeSingle(),
      admin.from("contact_tags").select("tags(name)").eq("contact_id", selected.contact_id),
    ]);
    timeline = timelineResult.timeline;
    automationRuns = timelineResult.automationRuns;
    contact = contactRow
      ? {
          id: contactRow.id as string,
          username: contactRow.username as string | null,
          avatarUrl: contactRow.avatar_url as string | null,
          platform: contactRow.platform as string,
          firstSeenAt: contactRow.first_seen_at as string,
          lastSeenAt: contactRow.last_seen_at as string,
        }
      : null;
    tags = (contactTags ?? []).map((t) => (t.tags as unknown as { name: string } | null)?.name).filter((n): n is string => !!n);
  }

  const lastEntry = timeline[timeline.length - 1];
  const context = <ContactContext contact={contact} receivedBy={selected?.socialAccountUsername ?? null} tags={tags} automationRuns={automationRuns} />;
  // Volta pra lista sem perder o channel ativo.
  const backHref = buildInboxHref({ channelId, filter, page });

  return (
    <>
      <PageHeader title="Caixa de entrada" description="Conversas com quem comentou ou mandou mensagem." />

      <div className="grid h-[calc(100dvh-14rem)] min-h-[28rem] md:h-[calc(100dvh-8.75rem)] grid-cols-1 overflow-hidden border-t border-border-subtle md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)_300px] 2xl:grid-cols-[340px_minmax(0,1fr)_340px]">
        {/* Coluna 1 — lista de conversas. A key zera a rolagem ao trocar de página, filtro ou canal, mas não ao abrir uma conversa. */}
        <div key={`${channelId}:${filter}:${page}`} className={`min-h-0 flex-col overflow-y-auto border-border-subtle md:flex md:border-r ${conversationId ? "hidden" : "flex"}`}>
          <ConversationList
            conversations={conversations}
            selectedId={selected?.id}
            channelId={channelId}
            filter={filter}
            page={page}
            hasMore={hasMore}
            unreadTotal={unreadTotal}
          />
        </div>

        {/* Coluna 2 — thread da conversa */}
        <div className={`min-h-0 min-w-0 flex-col overflow-hidden border-border-subtle lg:border-r ${conversationId ? "flex" : "hidden md:flex"}`}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="text-sm text-text-muted">Selecione uma conversa.</p>
            </div>
          ) : (
            <>
              <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border-subtle px-5 py-3">
                <div className="flex min-w-0 items-center gap-3">
                  <Link href={backHref} aria-label="Voltar para as conversas" className="-ml-1 p-1 text-text-secondary hover:text-text md:hidden">
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </Link>
                  <ContactAvatar username={contact?.username ?? null} avatarUrl={contact?.avatarUrl} />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-text">{contact?.username ? `@${contact.username}` : "Contato"}</p>
                    <p className="truncate text-xs text-text-muted">
                      {platformLabel(contact?.platform ?? "instagram")}
                      {selected.socialAccountUsername && ` · recebido por @${selected.socialAccountUsername}`}
                    </p>
                  </div>
                </div>
                <TakeoverToggle conversationId={selected.id} automationEnabled={selected.automation_enabled} />
              </header>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <Timeline
                  key={selected.id}
                  entries={timeline}
                  username={contact?.username ?? null}
                  lastKey={`${selected.id}:${lastEntry?.id ?? "empty"}:${timeline.length}`}
                />
              </div>

              <div className="shrink-0">
                {/* A key descarta o rascunho ao trocar de conversa: ele nunca pode ir para outra pessoa. */}
                <MessageComposer key={selected.id} conversationId={selected.id} socialAccountUsername={selected.socialAccountUsername} />

                {/* Contexto em mobile/tablet — disclosure simples via <details>, sem JS extra. Em lg+ vira a 3ª coluna fixa. */}
                <details className="border-t border-border-subtle lg:hidden">
                  <summary className="cursor-pointer px-5 py-2.5 text-[13px] font-medium text-text-secondary hover:text-text">Contexto do contato</summary>
                  <div className="max-h-[50dvh] overflow-y-auto px-5 pb-5 pt-2">{context}</div>
                </details>
              </div>
            </>
          )}
        </div>

        {/* Coluna 3 — contexto, só em telas grandes */}
        <aside className="hidden min-h-0 overflow-y-auto p-5 lg:block" aria-label="Contexto do contato">
          {selected && context}
        </aside>
      </div>
    </>
  );
}
