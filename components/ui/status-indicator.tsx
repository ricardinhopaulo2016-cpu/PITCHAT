import { SignalMarker } from "@/components/icons/pitchat";

/**
 * Status nunca depende só de cor (docs/PITCHAT_DESIGN_SYSTEM.md §12) — sempre
 * símbolo + texto. Nunca pill colorido grande (seção 25 do briefing).
 */
export type AutomationStatus = "draft" | "active" | "paused" | "archived";

const CONFIG: Record<AutomationStatus, { label: string; color: string; marker: "trigger" | "action" | "wait" | "end" }> = {
  active: { label: "Ativa", color: "var(--success)", marker: "action" },
  draft: { label: "Rascunho", color: "var(--text-muted)", marker: "trigger" },
  paused: { label: "Pausada", color: "var(--warning)", marker: "wait" },
  archived: { label: "Arquivada", color: "var(--text-muted)", marker: "end" },
};

export function StatusIndicator({ status }: { status: AutomationStatus }) {
  const config = CONFIG[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: config.color }}>
      <SignalMarker type={config.marker} width={10} height={10} style={{ color: config.color }} />
      {config.label}
    </span>
  );
}

/** Erro — vermelho, símbolo "!" próprio, não pill. */
export function ErrorIndicator({ count }: { count: number }) {
  if (count <= 0) return <span className="text-sm text-text-muted">0</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--danger)" }}>
      <SignalMarker type="error" width={10} height={10} style={{ color: "var(--danger)" }} />
      {count}
    </span>
  );
}
