import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));

import { comparisonWindows, periodComparison, resolvePeriod } from "@/lib/metrics/period";
import { clearViralCache, loadMetricsData, loadPeriodComparison } from "@/lib/metrics/repo";
import { classifyRpcError, hasMissing } from "@/lib/metrics/rpc";

describe("classifyRpcError", () => {
  it.each(["PGRST202", "42883", "42P01", "42703"])("%s é missing", (code) => {
    expect(classifyRpcError({ code })).toBe("missing");
  });

  it("57014 é timeout", () => {
    expect(classifyRpcError({ code: "57014" })).toBe("timeout");
  });

  it("outro código, null e undefined são error", () => {
    expect(classifyRpcError({ code: "XX000" })).toBe("error");
    expect(classifyRpcError(null)).toBe("error");
    expect(classifyRpcError(undefined)).toBe("error");
  });
});

describe("hasMissing", () => {
  it("detecta qualquer bloco sem migration", () => {
    expect(hasMissing([{ status: "ok", data: 1 }, { status: "missing" }])).toBe(true);
    expect(hasMissing([{ status: "ok", data: 1 }, { status: "timeout" }])).toBe(false);
  });
});

describe("loadMetricsData", () => {
  const NOW = new Date("2026-11-08T15:00:00.000Z");
  const WORKSPACE = "11111111-1111-1111-1111-111111111111";
  const input = {
    workspaceId: WORKSPACE,
    accountId: null,
    period: resolvePeriod(undefined, undefined, NOW),
    windows: comparisonWindows(NOW),
    runPrefix: "a1940a6a",
    now: NOW,
  };
  let logged: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    clearViralCache();
    logged = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    logged.mockRestore();
    vi.restoreAllMocks();
  });

  function fakeAdmin(rpc: (name: string, args: Record<string, unknown>, signal: AbortSignal) => unknown) {
    return {
      rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: (signal: AbortSignal) => rpc(name, args, signal) }),
    } as unknown as SupabaseClient;
  }

  it("toda RPC recebe o workspace_id", async () => {
    const calls: { name: string; args: Record<string, unknown> }[] = [];
    const data = await loadMetricsData(
      fakeAdmin(async (name, args) => {
        calls.push({ name, args });
        return { data: name === "metrics_windows_totals" ? { today: {}, yesterday_same_time: {}, yesterday: {}, last7: {}, previous7: {} } : {}, error: null };
      }),
      input
    );
    expect(calls).toHaveLength(9);
    expect(calls.every((call) => call.args.p_workspace_id === WORKSPACE)).toBe(true);
    expect(data.funnel.status).toBe("ok");
    expect(Object.keys(data.windows)).toEqual(["today", "yesterday_same_time", "yesterday", "last7", "previous7"]);
  });

  it("sem ?run não consulta incidente", async () => {
    const names: string[] = [];
    const data = await loadMetricsData(
      fakeAdmin(async (name) => {
        names.push(name);
        return { data: {}, error: null };
      }),
      { ...input, runPrefix: null }
    );
    expect(data.runIncident).toBeNull();
    expect(names).not.toContain("metrics_run_incident");
  });

  it("migration ausente vira missing sem lançar", async () => {
    const data = await loadMetricsData(
      fakeAdmin(async () => ({ data: null, error: { code: "PGRST202", message: "segredo", details: "segredo" } })),
      input
    );
    expect(data.daily.status).toBe("missing");
    expect(data.windows.last7.status).toBe("missing");
    expect(data.runIncident?.status).toBe("missing");
  });

  it("as cinco janelas vão numa chamada só e voltam por chave", async () => {
    let windowsArg: unknown;
    const data = await loadMetricsData(
      fakeAdmin(async (name, args) => {
        if (name === "metrics_windows_totals") {
          windowsArg = args.p_windows;
          return { data: { today: { comment_valid: 4 }, yesterday_same_time: {}, yesterday: {}, last7: {} }, error: null };
        }
        return { data: {}, error: null };
      }),
      input
    );
    expect(windowsArg).toHaveLength(5);
    expect(data.windows.today).toEqual({ status: "ok", data: { comment_valid: 4 } });
    expect(data.windows.previous7.status).toBe("error");
  });

  it("RPC que passa do prazo vira timeout só naquele bloco", async () => {
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(5));
    const data = await loadMetricsData(
      fakeAdmin((name, _args, signal) => {
        if (name !== "metrics_viral_base") return Promise.resolve({ data: {}, error: null });
        return new Promise((resolve) => signal.addEventListener("abort", () => resolve({ data: null, error: { code: "", message: "AbortError" } })));
      }),
      input
    );
    expect(data.viral.status).toBe("timeout");
    expect(data.funnel.status).toBe("ok");
  });

  it("base de viralização: reaproveita resultado bom e não guarda falha", async () => {
    let viralCalls = 0;
    const admin = fakeAdmin(async (name) => {
      if (name !== "metrics_viral_base") return { data: {}, error: null };
      viralCalls += 1;
      return viralCalls === 1 ? { data: null, error: { code: "XX000" } } : { data: { accounts: [], top_posts: [] }, error: null };
    });
    expect((await loadMetricsData(admin, input)).viral.status).toBe("error");
    expect((await loadMetricsData(admin, input)).viral.status).toBe("ok");
    expect((await loadMetricsData(admin, input)).viral.status).toBe("ok");
    expect(viralCalls).toBe(2);

    const later = new Date(NOW.getTime() + 5 * 60_000 + 1);
    await loadMetricsData(admin, { ...input, now: later });
    expect(viralCalls).toBe(3);
    await loadMetricsData(admin, { ...input, now: later, accountId: "outra-conta" });
    expect(viralCalls).toBe(4);
  });

  describe("loadPeriodComparison", () => {
    const comparison = periodComparison(resolvePeriod(undefined, undefined, NOW, "hoje"), NOW);
    const scope = { workspaceId: WORKSPACE, accountId: null, comparison };

    it("consulta atual e anterior em chamadas separadas, sempre com o workspace_id", async () => {
      const calls: { name: string; args: Record<string, unknown> }[] = [];
      const data = await loadPeriodComparison(
        fakeAdmin(async (name, args) => {
          calls.push({ name, args });
          if (name !== "metrics_windows_totals") return { data: {}, error: null };
          const [window] = args.p_windows as { key: string }[];
          return { data: { [window.key]: { run_started: window.key === "current" ? 7 : 3 } }, error: null };
        }),
        scope
      );
      expect(calls).toHaveLength(4);
      expect(calls.every((call) => call.args.p_workspace_id === WORKSPACE)).toBe(true);
      expect(data.currentTotals).toEqual({ status: "ok", data: { run_started: 7 } });
      expect(data.previousTotals).toEqual({ status: "ok", data: { run_started: 3 } });
      expect(calls.find((call) => call.name === "metrics_funnel")?.args.p_from).toBe(comparison.previous.startIso);
      expect(calls.find((call) => call.name === "metrics_response_times")?.args.p_to).toBe(comparison.previous.endIso);
    });

    it("falha na janela anterior não derruba o valor atual", async () => {
      const data = await loadPeriodComparison(
        fakeAdmin(async (name, args) => {
          if (name !== "metrics_windows_totals") return { data: null, error: { code: "57014" } };
          const [window] = args.p_windows as { key: string }[];
          return window.key === "current" ? { data: { current: { run_started: 7 } }, error: null } : { data: null, error: { code: "57014" } };
        }),
        scope
      );
      expect(data.currentTotals.status).toBe("ok");
      expect(data.previousTotals.status).toBe("timeout");
      expect(data.previousFunnel.status).toBe("timeout");
    });
  });

  it("exceção e data nula viram error, sem logar mensagem", async () => {
    const thrown = await loadMetricsData(
      fakeAdmin(async () => {
        throw new Error("segredo");
      }),
      input
    );
    expect(thrown.viral.status).toBe("error");
    const empty = await loadMetricsData(fakeAdmin(async () => ({ data: null, error: null })), input);
    expect(empty.confidence.status).toBe("error");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("segredo");
  });
});
