"use client";

import * as RadixDialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Wrapper fino do Radix Dialog — primeiro dialog real do PITCHAT (usado pelo
 * gate de revisão de publicação, ver publish-review-dialog.tsx). Motion e
 * radius seguem docs/PITCHAT_DESIGN_SYSTEM.md §6/§8 (`dialog-in`/`overlay-in`
 * já existiam em app/globals.css, nunca usados até agora).
 */
export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;

export function DialogContent({
  children,
  title,
  description,
  className = "",
}: {
  children: ReactNode;
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-[overlay-in_var(--motion-panel)_var(--ease-out)]" />
      <RadixDialog.Content
        className={`fixed left-1/2 top-1/2 z-50 max-h-[85vh] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-[var(--radius-panel-lg)] border border-border bg-surface-elevated p-6 shadow-[var(--shadow-elevated)] focus:outline-none data-[state=open]:animate-[dialog-in_var(--motion-panel)_var(--ease-out)] ${className}`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <RadixDialog.Title className="text-lg font-semibold text-text">{title}</RadixDialog.Title>
            {description && <RadixDialog.Description className="mt-1 text-sm text-text-secondary">{description}</RadixDialog.Description>}
          </div>
          <RadixDialog.Close asChild>
            <button aria-label="Fechar" className="rounded p-1 text-text-muted hover:bg-surface-2 hover:text-text">
              <X className="h-4 w-4" />
            </button>
          </RadixDialog.Close>
        </div>
        {children}
      </RadixDialog.Content>
    </RadixDialog.Portal>
  );
}
