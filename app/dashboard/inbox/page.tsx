import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { listConversations, loadConversationForWorkspace, loadConversationTimeline } from "@/lib/inbox/repo";
import { PageHeader } from "@/components/app-shell/page-header";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { ConversationList } from "@/components/inbox/conversation-list";
import { Timeline } from "@/components/inbox/timeline";
import { ContactContext, type InboxContact } from "@/components/inbox/contact-context";
import { TakeoverToggle } from "@/components/inbox/takeover-toggle";
import { MessageComposer } from "@/components/inbox/message-composer";
import { platformLabel } from "@/lib/ui/format";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const { conversation: conversationId } = await searchParams;

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  // listConversations (coluna 1) e loadConversationForWorkspace (a conversa
  // selecionada, se houver) não dependem uma da outra — só de
  // auth.workspace.id/conversationId, já resolvidos. Paraleliza (reauditoria
  // HEAD 24/09/2026).
  const [conversations, selected] = await Promise.all([
    listConversations(admin, auth.workspace.id),
    conversationId ? loadConversationForWorkspace(admin, conversationId, auth.workspace.id) : Promise.resolve(null),
  ]);

  let timeline: Awaited<ReturnType<typeof loadConversationTimeline>>["timeline"] = [];
  let automationRuns: Awaited<ReturnType<typeof loadConversationTimeline>>["automationRuns"] = [];
  let contact: InboxContact | null = null;
  let tags: string[] = [];

  if (selected) {
    // Marcar como lida, buscar timeline, contato e tags — as 4 operações só
    // dependem de `selected` (já resolvido acima), nenhuma depende do
    // resultado das outras. Paraleliza (reauditoria HEAD 24/09/2026).
    const [, timelineResult, { data: contactRow }, { data: contactTags }] = await Promise.all([
      admin.from("conversations").update({ last_read_at: new Date().toISOString() }).eq("id", selected.id),
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

  return (
    <>
      <PageHeader title="Inbox" description="Conversas reais com contatos do Instagram." />

      <div className="grid h-[calc(100dvh-14rem)] min-h-[28rem] grid-cols-1 overflow-hidden border-t border-border-subtle md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-[300px_minmax(0,1fr)_300px] 2xl:grid-cols-[340px_minmax(0,1fr)_340px]">
        {/* Coluna 1 — lista de conversas */}
        <div className={`min-h-0 flex-col overflow-y-auto border-border-subtle md:flex md:border-r ${conversationId ? "hidden" : "flex"}`}>
          <ConversationList conversations={conversations} selectedId={selected?.id} />
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
                  <Link href="/dashboard/inbox" aria-label="Voltar para as conversas" className="-ml-1 p-1 text-text-secondary hover:text-text md:hidden">
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
                  entries={timeline}
                  username={contact?.username ?? null}
                  lastKey={`${selected.id}:${lastEntry?.id ?? "empty"}:${timeline.length}`}
                />
              </div>

              <div className="shrink-0">
                <MessageComposer conversationId={selected.id} />

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
