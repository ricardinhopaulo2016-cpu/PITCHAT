import Link from "next/link";
import type { AutomationRunSummary } from "@/lib/inbox/repo";
import { ContactAvatar } from "@/components/contacts/contact-avatar";
import { SignalMarker, type SignalMarkerType } from "@/components/icons/pitchat";
import { formatDateTimeLong, formatLastActivity, platformLabel, timeAgo } from "@/lib/ui/format";

export type InboxContact = {
  id: string;
  username: string | null;
  avatarUrl: string | null;
  platform: string;
  firstSeenAt: string;
  lastSeenAt: string;
};

const RUN_STATUS: Record<string, { label: string; marker: SignalMarkerType; color: string }> = {
  running: { label: "Em execução", marker: "action", color: "var(--text-secondary)" },
  waiting: { label: "Aguardando", marker: "wait", color: "var(--warning)" },
  completed: { label: "Concluída", marker: "end", color: "var(--success)" },
  failed: { label: "Falhou", marker: "error", color: "var(--danger)" },
};

const WAITING_REASON: Record<string, string> = { delay: "delay", quick_reply: "resposta do contato", retry: "nova tentativa" };
const RUNS_SHOWN = 8;

/**
 * Painel de contexto do contato (coluna 3 / disclosure no tablet e mobile).
 * Seções separadas por hairline, sem pilha de cards. Automation runs é
 * observabilidade secundária: recolhida por padrão, nunca compete com a
 * conversa.
 */
export function ContactContext({
  contact,
  receivedBy,
  tags,
  automationRuns,
}: {
  contact: InboxContact | null;
  receivedBy: string | null;
  tags: string[];
  automationRuns: AutomationRunSummary[];
}) {
  const runs = [...automationRuns].reverse(); // mais recente primeiro
  const latest = runs[0];
  const latestStatus = latest ? RUN_STATUS[latest.status] : undefined;

  return (
    <div className="flex flex-col divide-y divide-border-subtle">
      <section className="pb-5" aria-labelledby="ctx-identity">
        <h2 id="ctx-identity" className="sr-only">
          Identidade
        </h2>
        <div className="flex items-center gap-3">
          <ContactAvatar username={contact?.username ?? null} avatarUrl={contact?.avatarUrl} size="lg" />
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-text">{contact?.username ? `@${contact.username}` : "Contato"}</p>
            <p className="text-xs text-text-muted">{platformLabel(contact?.platform ?? "instagram")}</p>
          </div>
        </div>
        {contact && (
          <Link href={`/dashboard/contacts/${contact.id}`} className="mt-3 inline-block text-xs text-text-secondary hover:text-signal">
            Ver contato
          </Link>
        )}
      </section>

      <section className="py-5" aria-labelledby="ctx-context">
        <h2 id="ctx-context" className="mb-3 text-[13px] font-medium text-text-secondary">
          Contexto
        </h2>
        <dl className="flex flex-col gap-2.5 text-sm">
          <div>
            <dt className="text-xs text-text-muted">Recebido por</dt>
            <dd className="text-text">{receivedBy ? `@${receivedBy}` : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Primeira interação</dt>
            <dd className="text-text">{contact ? formatDateTimeLong(contact.firstSeenAt) : "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-text-muted">Última atividade</dt>
            <dd className="text-text">{contact ? formatLastActivity(contact.lastSeenAt) : "—"}</dd>
          </div>
        </dl>
      </section>

      <section className="py-5" aria-labelledby="ctx-tags">
        <h2 id="ctx-tags" className="mb-3 text-[13px] font-medium text-text-secondary">
          Tags
        </h2>
        {tags.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhuma tag.</p>
        ) : (
          <ul className="flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <li key={t} className="rounded-full border border-border-subtle bg-surface-1 px-2 py-0.5 text-[11px] text-text-secondary">
                {t}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="pt-5" aria-labelledby="ctx-automation">
        <h2 id="ctx-automation" className="mb-3 text-[13px] font-medium text-text-secondary">
          Automação
        </h2>
        {runs.length === 0 ? (
          <p className="text-xs text-text-muted">Nenhuma automação rodou aqui ainda.</p>
        ) : (
          <details className="group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs text-text-secondary hover:text-text">
              <span className="min-w-0 truncate">{latest.automationName ?? "Automação"}</span>
              {latestStatus && (
                <span className="inline-flex shrink-0 items-center gap-1" style={{ color: latestStatus.color }}>
                  <SignalMarker type={latestStatus.marker} width={9} height={9} />
                  {latestStatus.label}
                </span>
              )}
            </summary>
            <ul className="mt-3 flex flex-col gap-3">
              {runs.slice(0, RUNS_SHOWN).map((run) => {
                const status = RUN_STATUS[run.status];
                return (
                  <li key={run.id} className="text-xs">
                    <p className="font-medium text-text">{run.automationName ?? "Automação"}</p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-text-muted">
                      {status ? (
                        <span className="inline-flex items-center gap-1" style={{ color: status.color }}>
                          <SignalMarker type={status.marker} width={9} height={9} />
                          {status.label}
                        </span>
                      ) : (
                        run.status
                      )}
                      {run.waitingReason && <span>· esperando {WAITING_REASON[run.waitingReason] ?? run.waitingReason}</span>}
                      <span>· {timeAgo(run.startedAt)}</span>
                    </p>
                    {run.lastError && <p className="mt-0.5 text-danger">{run.lastError}</p>}
                  </li>
                );
              })}
            </ul>
            {runs.length > RUNS_SHOWN && <p className="mt-2 text-[11px] text-text-muted">+ {runs.length - RUNS_SHOWN} execuções anteriores</p>}
          </details>
        )}
      </section>
    </div>
  );
}
