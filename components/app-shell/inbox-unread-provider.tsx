"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { useRealtime } from "./realtime-provider";
import { POLL_INTERVAL_MS, SAFETY_POLL_INTERVAL_MS, createRefreshScheduler, type RefreshScheduler } from "@/lib/realtime/policy";
import { useVisibleInterval } from "@/lib/ui/use-visible-interval";

const InboxUnreadContext = createContext(0);

export function useInboxUnreadCount(): number {
  return useContext(InboxUnreadContext);
}

/** Null em falha de rede ou resposta inesperada: quem chama mantém o último número. */
async function fetchUnreadCount(): Promise<number | null> {
  try {
    const response = await fetch("/api/inbox/unread-count", { cache: "no-store" });
    if (!response.ok) return null;
    const body = (await response.json()) as { count?: unknown };
    return typeof body.count === "number" ? body.count : null;
  } catch {
    return null;
  }
}

/**
 * Número de não lidas do menu lateral. Layout não renderiza de novo ao navegar,
 * então o valor do servidor só serve de início: daí em diante vem de uma rota
 * leve, sem recarregar a tela em que o operador está. `initialCount` não é
 * reaplicado depois da montagem.
 */
export function InboxUnreadProvider({ initialCount, children }: { initialCount: number; children: ReactNode }) {
  const [count, setCount] = useState(initialCount);
  const conversationId = useSearchParams().get("conversation");
  const { live, subscribe } = useRealtime();
  const scheduler = useRef<RefreshScheduler | null>(null);

  const refresh = useCallback(() => {
    void fetchUnreadCount().then((next) => {
      if (next !== null) setCount(next);
    });
  }, []);

  useEffect(() => {
    const instance = createRefreshScheduler({
      debounceMs: 400,
      retryMs: 1_500,
      getMinIntervalMs: () => 1_500,
      canRun: () => document.visibilityState === "visible",
      run: refresh,
    });
    scheduler.current = instance;
    const unsubscribe = subscribe((table) => {
      if (table === "conversations") instance.signal();
    });
    return () => {
      unsubscribe();
      instance.dispose();
      scheduler.current = null;
    };
  }, [refresh, subscribe]);

  useVisibleInterval(refresh, live ? SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS);

  // A URL só muda depois que o servidor já marcou a conversa como lida.
  useEffect(() => {
    if (conversationId) refresh();
  }, [conversationId, refresh]);

  return <InboxUnreadContext.Provider value={count}>{children}</InboxUnreadContext.Provider>;
}
