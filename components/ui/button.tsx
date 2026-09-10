import { forwardRef, type ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "tertiary" | "danger";

const base =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-button)] text-sm font-medium " +
  "transition-[background-color,border-color,color] duration-[var(--motion-fast)] ease-[var(--ease-standard)] " +
  "disabled:opacity-50 disabled:pointer-events-none px-3 h-9";

// Nunca hover:scale/bounce (docs/PITCHAT_DESIGN_SYSTEM.md §8) — só muda
// background/border/color, 90-120ms.
const variants: Record<Variant, string> = {
  primary: "bg-signal text-signal-on hover:bg-signal-hover active:bg-signal-pressed",
  secondary: "bg-surface-2 border border-border text-text hover:border-border-strong",
  tertiary: "text-text-secondary hover:text-text",
  danger: "bg-transparent border border-border text-danger hover:border-danger hover:bg-danger-soft",
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }>(
  ({ variant = "secondary", className, ...rest }, ref) => (
    <button ref={ref} className={`${base} ${variants[variant]} ${className ?? ""}`} {...rest} />
  )
);
Button.displayName = "Button";
