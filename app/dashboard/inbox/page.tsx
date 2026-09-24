import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { listConversations, loadConversationForWorkspace, loadConversationTimeline } from "@/lib/inbox/repo";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SignalMarker } from "@/components/icons/pitchat";
import { TakeoverToggle } from "./takeover-toggle";
import { MessageComposer } from "./message-composer";
import { PublicReplyAction } from "./public-reply-action";

export const dynamic = "force-dynamic";

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const ACTOR_LABEL: Record<"USER" | "AUTOMATION" | "HUMAN", { label: string; marker: "action" | "logic" | "trigger" }> = {
  USER: { label: "Contato", marker: "trigger" },
  AUTOMATION: { label: "Automação", marker: "action" },
  HUMAN: { label: "Você", marker: "logic" },
};

const RUN_STATUS_COLOR: Record<string, string> = {
  running: "var(--text-secondary)",
  waiting: "var(--warning)",
  completed: "var(--success)",
  failed: "var(--danger)",
};

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ conversation?: string }> }) {
  const { conversation: conversationId } = await searchParams;

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const conversations = await listConversations(admin, auth.workspace.id);

  let selected: Awaited<ReturnType<typeof loadConversationForWorkspace>> = null;
  let timeline: Awaited<ReturnType<typeof loadConversationTimeline>>["timeline"] = [];
  let automationRuns: Awaited<ReturnType<typeof loadConversationTimeline>>["automationRuns"] = [];
  let contact: { username: string | null; platform: string; first_seen_at: string; last_seen_at: string } | null = null;
  let tags: string[] = [];

  if (conversationId) {
    selected = await loadConversationForWorkspace(admin, conversationId, auth.workspace.id);
    if (selected) {
      // Marca como lida ao abrir — a própria visita já é a ação de "ler".
      await admin.from("conversations").update({ last_read_at: new Date().toISOString() }).eq("id", selected.id);

      const [timelineResult, { data: contactRow }, { data: contactTags }] = await Promise.all([
        loadConversationTimeline(admin, {
          conversationId: selected.id,
          contactId: selected.contact_id,
          socialAccountId: selected.social_account_id,
        }),
        admin.from("contacts").select("username, platform, first_seen_at, last_seen_at").eq("id", selected.contact_id).maybeSingle(),
        admin.from("contact_tags").select("tags(name)").eq("contact_id", selected.contact_id),
      ]);
      timeline = timelineResult.timeline;
      automationRuns = timelineResult.automationRuns;
      contact = contactRow;
      tags = (contactTags ?? []).map((t) => (t.tags as unknown as { name: string } | null)?.name).filter((n): n is string => !!n);
    }
  }

  return (
    <>
      <PageHeader title="Inbox" description="Conversas reais com contatos do Instagram." />

      <div className="grid flex-1 grid-cols-1 gap-0 overflow-hidden border-t border-border-subtle md:grid-cols-[280px_1fr] lg:grid-cols-[280px_1fr_280px]">
        {/* Coluna 1 — lista de conversas */}
        <div className={`flex-col overflow-y-auto border-border-subtle md:flex md:border-r ${conversationId ? "hidden" : "flex"}`}>
          {conversations.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nenhuma conversa ainda" description="Assim que alguém comentar ou mandar DM pra uma conta conectada, a conversa aparece aqui." />
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/dashboard/inbox?conversation=${c.id}`}
                    className={`flex flex-col gap-1 px-4 py-3 hover:bg-surface-1 ${c.id === conversationId ? "bg-surface-1" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.unread ? "font-semibold text-text" : "font-medium text-text"}`}>
                        {c.contactUsername ? `@${c.contactUsername}` : "Contato"}
                      </span>
                      <span className="shrink-0 text-[11px] text-text-muted">{timeAgo(c.previewAt)}</span>
                    </div>
                    <p className="truncate text-xs text-text-muted">{c.previewText ?? "Sem mensagens ainda"}</p>
                    <div className="flex items-center gap-2">
                      {c.unread && <span className="h-1.5 w-1.5 rounded-full bg-signal" aria-label="Não lida" />}
                      <span className="text-[11px] text-text-muted">{c.socialAccountUsername ? `@${c.socialAccountUsername}` : ""}</span>
                      {!c.automationEnabled && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-warning">
                          <SignalMarker type="wait" width={9} height={9} /> manual
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Coluna 2 — thread da conversa */}
        <div className={`flex-col overflow-hidden border-border-subtle md:flex md:border-r ${conversationId ? "flex" : "hidden"}`}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <p className="text-sm text-text-muted">Selecione uma conversa.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
                <Link href="/dashboard/inbox" className="text-sm text-text-secondary hover:text-text md:hidden">
                  ← Conversas
                </Link>
                <TakeoverToggle conversationId={selected.id} automationEnabled={selected.automation_enabled} />
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4">
                {timeline.length === 0 ? (
                  <p className="text-sm text-text-muted">Nenhuma mensagem ainda.</p>
                ) : (
                  <ul className="flex flex-col gap-3">
                    {timeline.map((entry) => {
                      const cfg = ACTOR_LABEL[entry.actor];
                      const isUser = entry.actor === "USER";
                      return (
                        <li key={entry.id} className={`flex flex-col gap-1 ${isUser ? "items-start" : "items-end"}`}>
                          <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                            <SignalMarker type={cfg.marker} width={9} height={9} />
                            {cfg.label} · {timeAgo(entry.at)}
                          </span>
                          <p
                            className={`max-w-[85%] whitespace-pre-wrap rounded-[var(--radius-panel-sm)] border px-3 py-2 text-sm ${
                              isUser ? "border-border-subtle bg-surface-1 text-text" : "border-signal/30 bg-signal-soft text-text"
                            }`}
                          >
                            {entry.text ?? <span className="italic text-text-muted">sem texto</span>}
                          </p>
                          {entry.commentId && <PublicReplyAction commentId={entry.commentId} />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>

              <MessageComposer conversationId={selected.id} />

              {/* Details em mobile/md — "drawer" simples via <details>, sem JS extra. Em lg+ some daqui e vira a 3ª coluna fixa. */}
              <details className="border-t border-border-subtle lg:hidden">
                <summary className="cursor-pointer px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-text-muted">
                  Detalhes do contato
                </summary>
                <div className="px-4 pb-4">
                  <ContactDetailsPanel contact={contact} tags={tags} automationRuns={automationRuns} />
                </div>
              </details>
            </>
          )}
        </div>

        {/* Coluna 3 — detalhes, só em telas grandes */}
        <div className="hidden overflow-y-auto lg:block">
          {selected && (
            <div className="p-4">
              <ContactDetailsPanel contact={contact} tags={tags} automationRuns={automationRuns} />
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function ContactDetailsPanel({
  contact,
  tags,
  automationRuns,
}: {
  contact: { username: string | null; platform: string; first_seen_at: string; last_seen_at: string } | null;
  tags: string[];
  automationRuns: Awaited<ReturnType<typeof loadConversationTimeline>>["automationRuns"];
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">Contato</p>
        <dl className="flex flex-col gap-2 text-sm">
          <div>
            <dt className="text-xs text-text-muted">Username</dt>
            <dd className="text-text">{contact?.username ? `@${contact.username}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Primeira vez visto</dt>
            <dd className="text-text">{contact ? new Date(contact.first_seen_at).toLocaleDateString("pt-BR") : "—"}</dd>
          </div>
        </dl>
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">Tags</p>
        {tags.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhuma tag.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span key={t} className="rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[11px] text-text-secondary">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Observabilidade técnica — sempre secundária, nunca em destaque na timeline principal. */}
      <div>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-muted">Automation runs</p>
        {automationRuns.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhuma automação rodou aqui ainda.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {automationRuns.map((run) => (
              <li key={run.id} className="rounded-[var(--radius-panel-sm)] border border-border-subtle bg-surface-1 px-2.5 py-2 text-xs">
                <p className="font-medium text-text">{run.automationName ?? "Automação"}</p>
                <p className="mt-0.5 flex items-center gap-1.5" style={{ color: RUN_STATUS_COLOR[run.status] ?? "var(--text-muted)" }}>
                  {run.status}
                  {run.waitingReason && ` · esperando: ${run.waitingReason}`}
                </p>
                {run.lastError && <p className="mt-0.5 text-danger">{run.lastError}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
