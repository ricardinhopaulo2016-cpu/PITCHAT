"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { hasDraftText } from "@/lib/inbox/view";
import {
  DEBOUNCE_MS,
  REALTIME_TABLES,
  RETRY_MS,
  createRefreshScheduler,
  liveStatusLabel,
  pollIntervalMs,
  routePolicy,
  shouldHoldRefresh,
  type RealtimeTable,
  type RefreshScheduler,
} from "@/lib/realtime/policy";
import { useVisibleInterval } from "@/lib/ui/use-visible-interval";

const RECONNECT_MS = 10_000;

type Listener = (table: RealtimeTable) => void;
type RealtimeValue = { live: boolean; subscribe: (listener: Listener) => () => void };

const RealtimeContext = createContext<RealtimeValue>({ live: false, subscribe: () => () => {} });

export function useRealtime(): RealtimeValue {
  return useContext(RealtimeContext);
}

/**
 * Um único canal por aba. O evento serve só de aviso de que algo mudou: os
 * dados continuam vindo do servidor, com workspace validado. O Realtime aplica
 * o RLS em cada evento usando o token da sessão do navegador.
 */
export function RealtimeProvider({ workspaceId, children }: { workspaceId: string; children: ReactNode }) {
  const [live, setLive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) return;

    let cancelled = false;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let channel: ReturnType<typeof supabase.channel> | null = null;

    async function connect(client: NonNullable<typeof supabase>) {
      try {
        await client.realtime.setAuth();
      } catch {
        // Sem token o canal falha e o status abaixo agenda a nova tentativa.
      }
      if (cancelled) return;

      const next = client.channel(`dash:${workspaceId}:${attempt}`);
      for (const table of REALTIME_TABLES) {
        next.on("postgres_changes", { event: "*", schema: "public", table, filter: `workspace_id=eq.${workspaceId}` }, () => {
          listeners.current.forEach((listener) => listener(table));
        });
      }
      channel = next;
      next.subscribe((status: string) => {
        if (cancelled) return;
        setLive(status === "SUBSCRIBED");
        if (status !== "SUBSCRIBED" && reconnect === null) {
          reconnect = setTimeout(() => setAttempt((n) => n + 1), RECONNECT_MS);
        }
      });
    }

    void connect(supabase);

    return () => {
      cancelled = true;
      if (reconnect !== null) clearTimeout(reconnect);
      if (channel) void supabase.removeChannel(channel);
      setLive(false);
    };
  }, [workspaceId, attempt]);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ live, subscribe }), [live, subscribe]);

  return (
    <RealtimeContext.Provider value={value}>
      <RealtimeRefresher />
      {children}
    </RealtimeContext.Provider>
  );
}

function RealtimeRefresher() {
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const { live, subscribe } = useRealtime();
  const [isRefreshing, startTransition] = useTransition();

  const pathRef = useRef(pathname);
  const refreshingRef = useRef(false);
  const lastInputAt = useRef(Number.NEGATIVE_INFINITY);
  const scheduler = useRef<RefreshScheduler | null>(null);

  useEffect(() => {
    pathRef.current = pathname;
    lastInputAt.current = Number.NEGATIVE_INFINITY;
  }, [pathname]);

  useEffect(() => {
    refreshingRef.current = isRefreshing;
  }, [isRefreshing]);

  useEffect(() => {
    function handleInput(event: Event) {
      if (event.target instanceof Element && !event.target.hasAttribute("data-inbox-draft")) lastInputAt.current = Date.now();
    }
    document.addEventListener("input", handleInput, true);
    return () => document.removeEventListener("input", handleInput, true);
  }, []);

  useEffect(() => {
    const instance = createRefreshScheduler({
      debounceMs: DEBOUNCE_MS,
      retryMs: RETRY_MS,
      getMinIntervalMs: () => routePolicy(pathRef.current)?.minIntervalMs ?? RETRY_MS,
      canRun: () =>
        routePolicy(pathRef.current) !== null &&
        !shouldHoldRefresh({
          hidden: document.visibilityState !== "visible",
          refreshing: refreshingRef.current,
          draftOpen: hasDraftText(document.querySelectorAll<HTMLTextAreaElement>("[data-inbox-draft]")),
          dialogOpen: document.querySelector('[role="dialog"], dialog[open]') !== null,
          heldByForm: document.querySelector("[data-realtime-hold]") !== null,
          lastInputAt: lastInputAt.current,
          now: Date.now(),
        }),
      run: () => startTransition(() => router.refresh()),
    });
    scheduler.current = instance;
    const unsubscribe = subscribe((table) => {
      if (routePolicy(pathRef.current)?.tables.includes(table)) instance.signal();
    });
    return () => {
      unsubscribe();
      instance.dispose();
      scheduler.current = null;
    };
  }, [router, subscribe]);

  const poll = useCallback(() => scheduler.current?.signal(), []);
  useVisibleInterval(poll, pollIntervalMs(routePolicy(pathname), live));

  return null;
}

export function LiveStatus({ className = "" }: { className?: string }) {
  const pathname = usePathname() ?? "";
  const { live } = useRealtime();
  const policy = routePolicy(pathname);
  const label = liveStatusLabel(policy, live);
  const isLive = label === "Ao vivo";

  return (
    <p role="status" className={`flex items-center gap-1.5 text-xs text-text-muted ${className}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${isLive ? "bg-success" : "bg-text-muted"}`} />
      {label}
    </p>
  );
}
