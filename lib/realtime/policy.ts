export const REALTIME_TABLES = [
  "conversations",
  "messages",
  "comments",
  "contacts",
  "automations",
  "automation_runs",
  "scheduled_posts",
  "media_assets",
] as const;

export type RealtimeTable = (typeof REALTIME_TABLES)[number];

export type RoutePolicy = {
  tables: readonly RealtimeTable[];
  /** Cada recarga custa de 1,2 a 2,2 s no servidor: tela cara recarrega menos. */
  minIntervalMs: number;
  /** Tela que também lê dado sem evento em tempo real (jobs, webhook, contas). */
  alwaysPollMs?: number;
};

export const POLL_INTERVAL_MS = 20_000;
export const SAFETY_POLL_INTERVAL_MS = 60_000;
export const DEBOUNCE_MS = 800;
export const RETRY_MS = 1_500;
export const INPUT_HOLD_MS = 30_000;

const ROUTES: readonly { prefix: string; exact?: boolean; policy: RoutePolicy }[] = [
  { prefix: "/dashboard", exact: true, policy: { tables: ["automations", "automation_runs", "scheduled_posts", "comments"], minIntervalMs: 5_000 } },
  { prefix: "/dashboard/metrics", policy: { tables: ["comments", "messages", "automation_runs", "scheduled_posts"], minIntervalMs: 15_000 } },
  { prefix: "/dashboard/inbox", policy: { tables: ["conversations", "messages", "comments", "automation_runs", "contacts"], minIntervalMs: 2_500 } },
  { prefix: "/dashboard/contacts", policy: { tables: ["contacts", "conversations"], minIntervalMs: 5_000 } },
  { prefix: "/dashboard/automations", exact: true, policy: { tables: ["automations", "automation_runs"], minIntervalMs: 5_000 } },
  { prefix: "/dashboard/publishing", policy: { tables: ["scheduled_posts", "media_assets"], minIntervalMs: 5_000 } },
  { prefix: "/dashboard/media", policy: { tables: ["media_assets"], minIntervalMs: 5_000 } },
  { prefix: "/dashboard/social-accounts", policy: { tables: ["automations"], minIntervalMs: 5_000, alwaysPollMs: POLL_INTERVAL_MS } },
  { prefix: "/dashboard/health", policy: { tables: ["conversations", "automation_runs"], minIntervalMs: 5_000, alwaysPollMs: POLL_INTERVAL_MS } },
];

/** Null: a tela nunca recarrega sozinha, como o editor de fluxo. */
export function routePolicy(pathname: string): RoutePolicy | null {
  const match = ROUTES.find((r) => pathname === r.prefix || (!r.exact && pathname.startsWith(`${r.prefix}/`)));
  return match?.policy ?? null;
}

export function pollIntervalMs(policy: RoutePolicy | null, live: boolean): number | null {
  if (!policy) return null;
  if (policy.alwaysPollMs) return policy.alwaysPollMs;
  return live ? SAFETY_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
}

export function liveStatusLabel(policy: RoutePolicy | null, live: boolean): string {
  if (!policy) return "Atualização pausada na edição";
  return live && !policy.alwaysPollMs ? "Ao vivo" : "Atualizando a cada 20 s";
}

export type RefreshBlockers = {
  hidden: boolean;
  refreshing: boolean;
  draftOpen: boolean;
  dialogOpen: boolean;
  heldByForm: boolean;
  lastInputAt: number;
  now: number;
};

/** Um refresh que falha vira navegação completa e apagaria o que está na tela. */
export function shouldHoldRefresh(b: RefreshBlockers): boolean {
  return b.hidden || b.refreshing || b.draftOpen || b.dialogOpen || b.heldByForm || b.now - b.lastInputAt < INPUT_HOLD_MS;
}

export type RefreshScheduler = { signal(): void; dispose(): void };

/**
 * Junta rajadas em uma recarga. A janela não reinicia a cada evento, senão um
 * fluxo contínuo adiaria a atualização para sempre. Enquanto `canRun` for falso
 * o pedido fica guardado, sem se perder.
 */
export function createRefreshScheduler(options: {
  debounceMs: number;
  retryMs: number;
  getMinIntervalMs: () => number;
  canRun: () => boolean;
  run: () => void;
  now?: () => number;
}): RefreshScheduler {
  const now = options.now ?? Date.now;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending = false;
  let lastRunAt = Number.NEGATIVE_INFINITY;

  function arm(delayMs: number) {
    timer = setTimeout(fire, delayMs);
  }

  function fire() {
    timer = null;
    if (!pending) return;
    const wait = lastRunAt + options.getMinIntervalMs() - now();
    if (wait > 0) return arm(wait);
    if (!options.canRun()) return arm(options.retryMs);
    pending = false;
    lastRunAt = now();
    options.run();
  }

  return {
    signal() {
      pending = true;
      if (timer === null) arm(options.debounceMs);
    },
    dispose() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pending = false;
    },
  };
}
