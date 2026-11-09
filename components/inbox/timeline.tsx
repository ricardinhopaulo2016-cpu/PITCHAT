import type { ReactNode } from "react";
import { AlertCircle, Check, CheckCheck } from "lucide-react";
import type { TimelineEntry } from "@/lib/inbox/repo";
import { PublicReplyAction } from "./public-reply-action";
import { ScrollToEnd } from "./scroll-to-end";
import { dayKey, formatClock, formatDayLabel, formatDeliveryLabel, type DeliveryState } from "@/lib/ui/format";

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
 * A conversa como ela aconteceu: quem comentou à esquerda, automação e você à
 * direita, e os eventos do fluxo (palavra-chave, espera, fim) centrados entre
 * as mensagens. Falha sempre traz o texto, nunca só a cor.
 */
export function Timeline({ entries, username, lastKey }: { entries: TimelineEntry[]; username: string | null; lastKey: string }) {
  if (entries.length === 0) {
    return <p className="px-8 py-6 text-sm text-text-muted">Nenhuma atividade ainda.</p>;
  }

  const leadName = username ? `@${username}` : "Contato";
  const rows: ReactNode[] = [];
  let previousDay: string | null = null;

  entries.forEach((entry) => {
    const day = dayKey(entry.at);
    if (day !== previousDay) {
      rows.push(
        <li key={`day-${day}`} className="py-1 text-center text-xs text-text-muted">
          {formatDayLabel(entry.at)}
        </li>
      );
      previousDay = day;
    }
    rows.push(<TimelineRow key={entry.id} entry={entry} leadName={leadName} />);
  });

  return (
    <div className="px-6 py-6 md:px-8">
      <ol aria-label="Conversa" className="flex flex-col gap-3.5">
        {rows}
      </ol>
      <ScrollToEnd trigger={lastKey} />
    </div>
  );
}

function TimelineRow({ entry, leadName }: { entry: TimelineEntry; leadName: string }) {
  const time = formatClock(entry.at);

  if (entry.channel === "engine" && entry.signal) {
    const isError = entry.signal.marker === "error";
    return (
      <li className={`text-center text-xs ${isError ? "font-medium text-danger" : "text-text-muted"}`}>
        {entry.signal.label}
        {entry.signal.detail && `: ${entry.signal.detail}`} · {time}
      </li>
    );
  }

  const isLead = entry.actor === "USER";
  return (
    <li className={`flex ${isLead ? "justify-start" : "justify-end"}`}>
      <div className={`max-w-[min(68%,560px)] min-w-0 px-4 py-3 ${isLead ? "rounded-[16px_16px_16px_4px] bg-surface-2" : "rounded-[16px_16px_4px_16px] bg-surface-3"}`}>
        <MessageBlock entry={entry} leadName={leadName} time={time} />
      </div>
    </li>
  );
}

/** Só o domínio — a URL completa segue no `title` (tooltip); o rótulo do botão é o protagonista. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
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
      <p className="flex flex-wrap items-baseline gap-x-1.5 text-xs text-text-muted">
        {actorLabel}
        <span aria-hidden="true">·</span>
        <span>{kindLabel(entry)}</span>
        <span aria-hidden="true">·</span>
        <span>{time}</span>
      </p>

      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text">
        {entry.text ?? <span className="italic text-text-muted">sem texto</span>}
      </p>

      {entry.options && entry.options.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Opções enviadas">
          {entry.options.map((o) => (
            <li key={o} className="rounded-[var(--radius-input)] border border-border-strong px-3 py-1.5 text-xs font-semibold text-text">
              {o}
            </li>
          ))}
        </ul>
      )}

      {entry.button && (
        <p className="mt-2 inline-flex max-w-full items-baseline gap-2 rounded-[var(--radius-input)] border border-border-strong px-3 py-1.5 text-xs" title={entry.button.url}>
          <span className="shrink-0 font-semibold text-text">{entry.button.title}</span>
          <span className="max-w-[9rem] truncate text-xs text-text-muted/80">{hostOf(entry.button.url)}</span>
        </p>
      )}

      {entry.channel === "comment" && entry.actor === "USER" && entry.externalMediaId && (
        <p className="mt-1 text-xs text-text-muted">
          Comentário no post · <span className="font-mono">{truncateMediaId(entry.externalMediaId)}</span>
        </p>
      )}

      {entry.commentId && (
        <div className="mt-1.5">
          <PublicReplyAction commentId={entry.commentId} />
        </div>
      )}

      {entry.delivery && <DeliveryIndicator delivery={entry.delivery} />}
    </div>
  );
}

/** Situação de uma DM enviada: sempre ícone e texto, nunca só cor. */
function DeliveryIndicator({ delivery }: { delivery: DeliveryState }) {
  const Icon = delivery.state === "seen" ? CheckCheck : delivery.state === "failed" ? AlertCircle : Check;
  const color = delivery.state === "failed" ? "text-danger" : delivery.state === "seen" ? "text-signal" : "text-text-muted";
  return (
    <p className={`mt-1 flex items-center justify-end gap-1 text-xs ${color}`}>
      <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {formatDeliveryLabel(delivery)}
    </p>
  );
}
