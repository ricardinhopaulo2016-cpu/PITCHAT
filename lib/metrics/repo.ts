import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HEALTH_THRESHOLDS } from "@/lib/health/thresholds";
import { FUNNEL_POST_LIMIT, GOAL_PHRASE, INCIDENT_LIMIT, RPC_TIMEOUT_MS, TOP_GOAL_POSTS, VIRAL_CACHE_TTL_MS } from "./constants";
import type { RawDaily, Sources } from "./daily";
import type { RawFailures, RawRunIncident } from "./failures";
import type { RawFlow } from "./flow";
import type { RawFunnel } from "./funnel";
import type { ComparisonWindow, MetricsPeriod, WindowKey } from "./period";
import type { RawResponseTimes } from "./response-time";
import { classifyRpcError, type RpcResult } from "./rpc";
import { matureBeforeIso, type RawViral } from "./viral";

export type { RawDaily, RawFailures, RawRunIncident, RawFlow, RawFunnel, RawResponseTimes, RawViral };

export type RawConfidence = {
  sources: Sources;
  posts_observed: number;
  posts_unlinked: number;
  posts_published_without_media_id: number;
  comments_total: number;
  comments_without_contact: number;
  comments_contact_reconciled: number;
  comments_without_author: number;
  requests_without_author: number;
  requests_without_execution: number;
  runs_total: number;
  runs_without_contact: number;
  runs_without_conversation: number;
  runs_comment_not_found: number;
  runs_inactive_automation: number;
};

export type MetricsData = {
  daily: RpcResult<RawDaily[]>;
  windows: Record<WindowKey, RpcResult<Record<string, number>>>;
  confidence: RpcResult<RawConfidence>;
  funnel: RpcResult<RawFunnel>;
  flow: RpcResult<RawFlow>;
  responseTimes: RpcResult<RawResponseTimes>;
  failures: RpcResult<RawFailures>;
  viral: RpcResult<RawViral>;
  runIncident: RpcResult<RawRunIncident[]> | null;
};

/** Nunca lança: a migration pode não estar aplicada e a página precisa continuar de pé. */
async function callRpc<T>(admin: SupabaseClient, name: string, args: Record<string, unknown>): Promise<RpcResult<T>> {
  const deadline = AbortSignal.timeout(RPC_TIMEOUT_MS);
  try {
    const { data, error } = await admin.rpc(name, args).abortSignal(deadline);
    if (deadline.aborted) {
      console.error("[metrics] rpc excedeu o prazo", name);
      return { status: "timeout" };
    }
    if (error) {
      console.error("[metrics] rpc falhou", name, error.code);
      return { status: classifyRpcError(error) };
    }
    if (data === null) {
      console.error("[metrics] rpc falhou", name, undefined);
      return { status: "error" };
    }
    return { status: "ok", data: data as T };
  } catch (thrown) {
    if (deadline.aborted) {
      console.error("[metrics] rpc excedeu o prazo", name);
      return { status: "timeout" };
    }
    const code = (thrown as { code?: string } | null)?.code;
    console.error("[metrics] rpc falhou", name, code);
    return { status: classifyRpcError({ code }) };
  }
}

const viralCache = new Map<string, { expiresAt: number; result: RpcResult<RawViral> }>();
const VIRAL_CACHE_MAX_ENTRIES = 100;

export function clearViralCache(): void {
  viralCache.clear();
}

/** Só guarda resultado bom, por workspace e conta, para o F5 não reler todo o histórico. */
async function loadViral(admin: SupabaseClient, args: Record<string, unknown>, workspaceId: string, accountId: string | null, now: Date): Promise<RpcResult<RawViral>> {
  const key = `${workspaceId}|${accountId ?? "all"}`;
  const cached = viralCache.get(key);
  if (cached && cached.expiresAt > now.getTime()) return cached.result;

  const result = await callRpc<RawViral>(admin, "metrics_viral_base", args);
  if (result.status === "ok") {
    if (viralCache.size >= VIRAL_CACHE_MAX_ENTRIES) viralCache.clear();
    viralCache.set(key, { expiresAt: now.getTime() + VIRAL_CACHE_TTL_MS, result });
  }
  return result;
}

function splitWindows(result: RpcResult<Record<string, Record<string, number>>>, windows: ComparisonWindow[]): MetricsData["windows"] {
  return Object.fromEntries(
    windows.map((window): [WindowKey, RpcResult<Record<string, number>>] => {
      if (result.status !== "ok") return [window.key, { status: result.status }];
      const totals = result.data[window.key];
      return [window.key, totals ? { status: "ok", data: totals } : { status: "error" }];
    })
  ) as MetricsData["windows"];
}

export async function loadMetricsData(
  admin: SupabaseClient,
  input: {
    workspaceId: string;
    accountId: string | null;
    period: MetricsPeriod;
    windows: ComparisonWindow[];
    runPrefix: string | null;
    now: Date;
  }
): Promise<MetricsData> {
  const { workspaceId, accountId, period, windows, runPrefix, now } = input;
  const account = { p_workspace_id: workspaceId, p_account_id: accountId };
  const scoped = { ...account, p_phrase: GOAL_PHRASE };
  const inPeriod = { p_from: period.startIso, p_to: period.endIso };
  const stuckBefore = new Date(now.getTime() - HEALTH_THRESHOLDS.RUN_STUCK_RUNNING_MINUTES * 60_000).toISOString();

  const [daily, windowResults, confidence, funnel, flow, responseTimes, failures, viral, runIncident] = await Promise.all([
    callRpc<RawDaily[]>(admin, "metrics_daily", { ...scoped, ...inPeriod }),
    callRpc<Record<string, Record<string, number>>>(admin, "metrics_windows_totals", {
      ...scoped,
      p_windows: windows.map((window) => ({ key: window.key, from: window.startIso, to: window.endIso })),
    }),
    callRpc<RawConfidence>(admin, "metrics_data_confidence", { ...scoped, ...inPeriod }),
    callRpc<RawFunnel>(admin, "metrics_funnel", { ...scoped, ...inPeriod, p_post_limit: FUNNEL_POST_LIMIT }),
    callRpc<RawFlow>(admin, "metrics_message_flow", { ...account, ...inPeriod }),
    callRpc<RawResponseTimes>(admin, "metrics_response_times", { ...scoped, ...inPeriod }),
    callRpc<RawFailures>(admin, "metrics_failures", {
      ...account,
      ...inPeriod,
      p_stuck_before: stuckBefore,
      p_incident_limit: INCIDENT_LIMIT,
    }),
    loadViral(admin, { ...scoped, p_mature_before: matureBeforeIso(now), p_top_limit: TOP_GOAL_POSTS }, workspaceId, accountId, now),
    runPrefix
      ? callRpc<RawRunIncident[]>(admin, "metrics_run_incident", { ...account, p_run_prefix: runPrefix })
      : Promise.resolve(null),
  ]);

  return {
    daily,
    windows: splitWindows(windowResults, windows),
    confidence,
    funnel,
    flow,
    responseTimes,
    failures,
    viral,
    runIncident,
  };
}
