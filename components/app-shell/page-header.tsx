import type { ReactNode } from "react";

/** Título, uma frase que diz o estado da tela e a ação principal. */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 px-6 pb-7 pt-8 md:px-11 md:pt-9">
      <div className="min-w-0">
        <h1 className="text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] text-text">{title}</h1>
        {description && <p className="mt-2 text-base text-text-secondary">{description}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
