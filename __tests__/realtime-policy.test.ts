import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  INPUT_HOLD_MS,
  POLL_INTERVAL_MS,
  SAFETY_POLL_INTERVAL_MS,
  createRefreshScheduler,
  liveStatusLabel,
  pollIntervalMs,
  routePolicy,
  shouldHoldRefresh,
  type RefreshBlockers,
} from "@/lib/realtime/policy";

describe("routePolicy", () => {
  it("nunca recarrega o editor de fluxo, mas recarrega a lista de automações", () => {
    expect(routePolicy("/dashboard/automations/abc")).toBeNull();
    expect(routePolicy("/dashboard/automations")?.tables).toContain("automation_runs");
  });

  it("a Caixa de entrada reage a mensagem, comentário e conversa", () => {
    expect(routePolicy("/dashboard/inbox")?.tables).toEqual(expect.arrayContaining(["messages", "comments", "conversations"]));
  });

  it("a visão geral não casa com as subrotas", () => {
    expect(routePolicy("/dashboard")?.minIntervalMs).toBe(5_000);
    expect(routePolicy("/dashboard/metrics")?.minIntervalMs).toBe(15_000);
    expect(routePolicy("/outra")).toBeNull();
  });
});

describe("intervalo de segurança", () => {
  const inbox = routePolicy("/dashboard/inbox");
  const health = routePolicy("/dashboard/health");

  it("cai para 20 s quando o canal não está conectado", () => {
    expect(pollIntervalMs(inbox, false)).toBe(POLL_INTERVAL_MS);
    expect(pollIntervalMs(inbox, true)).toBe(SAFETY_POLL_INTERVAL_MS);
  });

  it("tela com dado sem evento segue por intervalo mesmo ao vivo", () => {
    expect(pollIntervalMs(health, true)).toBe(POLL_INTERVAL_MS);
    expect(liveStatusLabel(health, true)).toBe("Atualizando a cada 20 s");
  });

  it("o editor não tem intervalo e diz que está pausado", () => {
    expect(pollIntervalMs(null, true)).toBeNull();
    expect(liveStatusLabel(null, true)).toBe("Atualização pausada na edição");
    expect(liveStatusLabel(inbox, true)).toBe("Ao vivo");
  });
});

describe("shouldHoldRefresh", () => {
  const free: RefreshBlockers = {
    hidden: false,
    refreshing: false,
    draftOpen: false,
    dialogOpen: false,
    heldByForm: false,
    lastInputAt: Number.NEGATIVE_INFINITY,
    now: 1_000_000,
  };

  it("libera sem nada em andamento", () => {
    expect(shouldHoldRefresh(free)).toBe(false);
  });

  it.each(["hidden", "refreshing", "draftOpen", "dialogOpen", "heldByForm"] as const)("segura com %s", (key) => {
    expect(shouldHoldRefresh({ ...free, [key]: true })).toBe(true);
  });

  it("segura logo depois de digitar em formulário e libera depois", () => {
    expect(shouldHoldRefresh({ ...free, lastInputAt: free.now - 1_000 })).toBe(true);
    expect(shouldHoldRefresh({ ...free, lastInputAt: free.now - INPUT_HOLD_MS })).toBe(false);
  });
});

describe("createRefreshScheduler", () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  function setup(minIntervalMs = 5_000) {
    const run = vi.fn();
    let allowed = true;
    const scheduler = createRefreshScheduler({
      debounceMs: 800,
      retryMs: 1_500,
      getMinIntervalMs: () => minIntervalMs,
      canRun: () => allowed,
      run,
    });
    return { run, scheduler, block: (value: boolean) => (allowed = !value) };
  }

  it("rajada vira uma recarga só", () => {
    const { run, scheduler } = setup();
    for (let i = 0; i < 20; i++) scheduler.signal();
    vi.advanceTimersByTime(800);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("fluxo contínuo não adia para sempre e respeita o intervalo mínimo", () => {
    const { run, scheduler } = setup();
    for (let elapsed = 0; elapsed < 12_000; elapsed += 200) {
      scheduler.signal();
      vi.advanceTimersByTime(200);
    }
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(run.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it("guarda o pedido enquanto estiver bloqueado e roda ao liberar", () => {
    const { run, scheduler, block } = setup();
    block(true);
    scheduler.signal();
    vi.advanceTimersByTime(20_000);
    expect(run).not.toHaveBeenCalled();
    block(false);
    vi.advanceTimersByTime(1_500);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("dispose cancela o pedido pendente", () => {
    const { run, scheduler } = setup();
    scheduler.signal();
    scheduler.dispose();
    vi.advanceTimersByTime(10_000);
    expect(run).not.toHaveBeenCalled();
  });
});
