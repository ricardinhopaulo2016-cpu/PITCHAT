import { SignalMarker, type SignalMarkerType } from "@/components/icons/pitchat";

export type ActivityEntry = {
  id: string;
  marker: SignalMarkerType;
  title: string;
  detail?: string;
  timestamp: string;
};

/**
 * Representa tempo e execução real — não é decoração (docs/PITCHAT_DESIGN_SYSTEM.md,
 * seção 23 do briefing). Renderiza só o que veio do banco.
 */
export function ActivityRail({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return <p className="px-5 py-6 text-sm text-text-muted">Nenhuma atividade ainda.</p>;
  }

  return (
    <ol className="px-5 py-4">
      {entries.map((entry, i) => (
        <li key={entry.id} className="relative flex gap-3 pb-5 last:pb-0">
          {i < entries.length - 1 && (
            <span className="absolute left-[6.5px] top-4 h-full w-px bg-border" aria-hidden="true" />
          )}
          <SignalMarker type={entry.marker} className="mt-0.5 shrink-0 text-text-secondary" />
          <div className="min-w-0">
            <p className="text-sm text-text">{entry.title}</p>
            {entry.detail && <p className="truncate text-xs text-text-muted">{entry.detail}</p>}
            <p className="mt-0.5 text-xs text-text-muted">{formatRelativeTime(entry.timestamp)}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `há ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  return `há ${days} d`;
}
