import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Select nativo estilizado (não Radix) — teclado/acessibilidade do browser
 * de graça, sem o custo de markup de Trigger/Content/Viewport agora.
 * Lucide aqui é ferramenta secundária (chevron), não identidade — ok pelo
 * design system (docs/PITCHAT_DESIGN_SYSTEM.md §10).
 */
export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...rest }, ref) => (
    <div className="relative">
      <select
        ref={ref}
        className={`h-9 w-full appearance-none rounded-[var(--radius-input)] border border-border bg-surface-1 px-3 pr-8 text-sm text-text transition-colors duration-[var(--motion-fast)] focus-visible:border-signal focus-visible:outline-none ${className ?? ""}`}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
    </div>
  )
);
Select.displayName = "Select";
