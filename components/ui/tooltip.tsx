"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";

/**
 * Tooltip acessível pra ícone-só (Rail da Fase B — Signal Desk V2). Mesmo
 * timing de dropdown já usado no resto do app (140ms, opacity+translateY,
 * docs/PITCHAT_DESIGN_SYSTEM.md §8) — nunca substitui aria-label, só reforça
 * visualmente pra quem usa mouse.
 */
export function TooltipProvider({ children }: { children: React.ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={300} skipDelayDuration={100}>
      {children}
    </TooltipPrimitive.Provider>
  );
}

export function Tooltip({
  content,
  side = "right",
  children,
}: {
  content: string;
  side?: "top" | "right" | "bottom" | "left";
  children: React.ReactNode;
}) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={10}
          className="z-50 rounded-[var(--radius-panel-sm)] border border-border bg-surface-elevated px-2.5 py-1.5 text-xs text-text shadow-[var(--shadow-elevated)] data-[state=delayed-open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-surface-elevated" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
