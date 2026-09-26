import type { ReactNode } from "react";
import type { TimelineEntry } from "@/lib/inbox/repo";
import { SignalMarker } from "@/components/icons/pitchat";
import { PublicReplyAction } from "./public-reply-action";
import { ScrollToEnd } from "./scroll-to-end";
import { dayKey, formatClock, formatDayLabel } from "@/lib/ui/format";

/**
 * `180949…41213` — achado real 24/09/2026: o mesmo contato pode comentar a
 * mesma frase em dois posts diferentes, e a timeline (que agrega por
 * contact_id, não por media) mostrava os dois lado a lado sem dizer de qual
 * post vinha cada um, parecendo duplicata. Sem permalink/thumbnail
 * persistido em lugar nenhum do schema hoje — não dá pra linkar pro post
 * real ainda, só mostrar o ID truncado como contexto técnico.
 */
function truncateMediaId(id: string): string {
  if (id.length <= 14) return id;
  return `${id.slice(0, 6)}…${id.slice(-5)}`;
}

/**
 * Timeline operacional: leitura vertical cronológica sobre uma spine de 1px,
 * sem bolhas esquerda/direita. Signal Markers (◆ ‖ ■ !) ficam reservados
 * pra eventos de engine; o evento do lead (comentário, clique, DM) usa ● de
 * trigger; mensagens de automação/humano são só tipografia sobre a spine.
 */
export function Timeline({ entries, username, lastKey }: { entries: TimelineEntry[]; username: string | null; lastKey: string }) {
  if (entries.length === 0) {
    return <p className="px-5 py-4 text-sm text-text-muted">Nenhuma atividade ainda.</p>;
  }

  const leadName = username ? `@${username}` : "Contato";
  const rows: ReactNode[] = [];
  let previousDay: string | null = null;

  entries.forEach((entry, index) => {
    const day = dayKey(entry.at);
    if (day !== previousDay) {
      rows.push(
        <li key={`day-${day}`} className="pb-3 pl-8 pt-1 text-[11px] text-text-muted">
          {formatDayLabel(entry.at)}
        </li>
      );
      previousDay = day;
    }
    rows.push(<TimelineRow key={entry.id} entry={entry} leadName={leadName} first={index === 0} last={index === entries.length - 1} />);
  });

  return (
    <div className="px-5 py-4">
      <ol aria-label="Linha do tempo da conversa">{rows}</ol>
      <ScrollToEnd trigger={lastKey} />
    </div>
  );
}

function TimelineRow({ entry, leadName, first, last }: { entry: TimelineEntry; leadName: string; first: boolean; last: boolean }) {
  const isSignal = entry.channel === "engine" && !!entry.signal;
  const isLead = entry.actor === "USER";
  const time = formatClock(entry.at);

  // Spine: 1px contínua, começa no marker do primeiro item e termina no marker do último.
  const spine = `absolute left-[9.5px] w-px bg-border-subtle ${first ? "top-2.5" : "top-0"} ${last ? "h-2.5" : "bottom-0"}`;
  const showSpine = !(first && last);

  return (
    <li className={`relative grid grid-cols-[20px_1fr] gap-x-3 ${last ? "" : "pb-5"}`}>
      {showSpine && <span aria-hidden="true" className={spine} />}

      <div className="relative z-10 flex justify-center pt-[3px]">
        {isSignal && entry.signal && (
          <span className="bg-bg" style={{ color: entry.signal.marker === "error" ? "var(--danger)" : "var(--text-secondary)" }}>
            <SignalMarker type={entry.signal.marker} width={12} height={12} />
          </span>
        )}
        {isLead && (
          <span className="bg-bg text-text-secondary">
            <SignalMarker type="trigger" width={12} height={12} />
          </span>
        )}
      </div>

      <div className="min-w-0">
        {isSignal && entry.signal ? (
          <div className="flex flex-wrap items-baseline gap-x-2 text-[13px]">
            <span className={entry.signal.marker === "error" ? "font-medium text-danger" : "text-text-secondary"}>{entry.signal.label}</span>
            {entry.signal.detail && (
              <span className={entry.signal.marker === "logic" ? "font-mono text-xs text-text-muted" : "text-xs text-text-muted"}>
                {entry.signal.detail}
              </span>
            )}
            <span className="text-[11px] text-text-muted">{time}</span>
          </div>
        ) : (
          <MessageBlock entry={entry} leadName={leadName} time={time} />
        )}
      </div>
    </li>
  );
}

function kindLabel(entry: TimelineEntry): string {
  if (entry.actor === "USER") {
    if (entry.channel === "comment") return "Comentário";
    return entry.messageType === "quick_reply" ? "Quick reply" : "Mensagem";
  }
  if (entry.channel === "comment") return "Resposta pública";
  if (entry.messageType === "quick_reply") return "Mensagem com opções";
  if (entry.messageType === "button") return "Mensagem com botão";
  return "Mensagem";
}

function MessageBlock({ entry, leadName, time }: { entry: TimelineEntry; leadName: string; time: string }) {
  const actorLabel =
    entry.actor === "USER" ? (
      <span className="font-medium text-text">{leadName}</span>
    ) : entry.actor === "AUTOMATION" ? (
      <span className="text-text-secondary">Automação</span>
    ) : (
      <span className="font-medium text-signal">Você</span>
    );

  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-[12px] text-text-muted">
        {actorLabel}
        <span aria-hidden="true">·</span>
        <span>{kindLabel(entry)}</span>
        <span aria-hidden="true">·</span>
        <span>{time}</span>
      </p>

      <p className={`mt-1 whitespace-pre-wrap text-sm leading-relaxed ${entry.actor === "AUTOMATION" ? "text-text-secondary" : "text-text"}`}>
        {entry.text ?? <span className="italic text-text-muted">sem texto</span>}
      </p>

      {entry.options && entry.options.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Opções enviadas">
          {entry.options.map((o) => (
            <li key={o} className="rounded-[var(--radius-input)] border border-border px-2.5 py-1 text-xs text-text-secondary">
              {o}
            </li>
          ))}
        </ul>
      )}

      {entry.button && (
        <p className="mt-2 inline-flex max-w-full items-center gap-2 rounded-[var(--radius-input)] border border-border px-2.5 py-1 text-xs text-text-secondary">
          <span className="font-medium text-text">{entry.button.title}</span>
          <span className="truncate font-mono text-[11px] text-text-muted">{entry.button.url}</span>
        </p>
      )}

      {entry.channel === "comment" && entry.actor === "USER" && entry.externalMediaId && (
        <p className="mt-1 text-[11px] text-text-muted">
          Comentário no post · <span className="font-mono">{truncateMediaId(entry.externalMediaId)}</span>
        </p>
      )}

      {entry.commentId && (
        <div className="mt-1.5">
          <PublicReplyAction commentId={entry.commentId} />
        </div>
      )}
    </div>
  );
}
