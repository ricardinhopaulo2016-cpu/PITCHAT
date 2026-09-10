import type { ReactNode } from "react";

/** Sem hero, sem slogan, sem marketing — título + descrição curta + ação principal (docs/PITCHAT_DESIGN_SYSTEM.md, seção 21 do briefing). */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pb-6 pt-7 md:px-8 md:pt-8">
      <div>
        <h1 className="text-[28px] font-semibold tracking-[-0.025em] text-text">{title}</h1>
        {description && <p className="mt-1.5 text-sm text-text-secondary">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
