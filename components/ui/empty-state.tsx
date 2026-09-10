import type { ReactNode } from "react";

/**
 * Sem ícone gigante dentro de círculo, sem sparkles, sem "Let's get
 * started!" — copy concreta sobre o que falta pra funcionar (docs/PITCHAT_DESIGN_SYSTEM.md,
 * seção 33 do briefing).
 */
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 px-6 py-8 text-center">
      <p className="text-sm font-medium text-text">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-text-secondary">{description}</p>
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}
