"use client";

import * as ToastPrimitive from "@radix-ui/react-toast";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { playSound } from "@/lib/sound";

type ToastTone = "success" | "danger";
type ToastItem = { id: number; message: string; tone: ToastTone };

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

/**
 * Toast só pra feedback que precisa persistir um instante e ser notado
 * (publish, erro) — não pra tudo (docs/PITCHAT_DESIGN_SYSTEM.md §9, seção 38
 * do briefing). 180ms entrada / 140ms saída via CSS, tema signal/danger.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((message: string, tone: ToastTone = "success") => {
    const id = Date.now();
    setItems((prev) => [...prev, { id, message, tone }]);
    playSound(tone === "success" ? "success" : "error");
  }, []);

  return (
    <ToastContext.Provider value={push}>
      <ToastPrimitive.Provider swipeDirection="right" duration={4000}>
        {children}
        {items.map((item) => (
          <ToastPrimitive.Root
            key={item.id}
            onOpenChange={(open) => {
              if (!open) setItems((prev) => prev.filter((i) => i.id !== item.id));
            }}
            className="pitchat-toast rounded-[var(--radius-panel-sm)] border px-4 py-3 text-sm shadow-[var(--shadow-elevated)] data-[state=open]:animate-[toast-in_var(--motion-panel)_var(--ease-out)] data-[state=closed]:animate-[toast-out_var(--motion-ui)_var(--ease-standard)]"
            style={{
              background: "var(--surface-elevated)",
              borderColor: item.tone === "danger" ? "var(--danger)" : "var(--border-strong)",
              color: "var(--text)",
            }}
          >
            <ToastPrimitive.Description>{item.message}</ToastPrimitive.Description>
          </ToastPrimitive.Root>
        ))}
        <ToastPrimitive.Viewport className="fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2 outline-none" />
      </ToastPrimitive.Provider>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const push = useContext(ToastContext);
  if (!push) throw new Error("useToast precisa estar dentro de <ToastProvider>");
  return push;
}
