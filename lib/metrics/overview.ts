import { NO_BASE_LABEL } from "./constants";
import { readCombinedWindow, windowDelta, type EventKind, type SourceSpan, type Sources, type WindowReading } from "./daily";
import type { FunnelCounts } from "./funnel";
import type { PeriodComparison, TimeBounds } from "./period";
import { formatCount, formatDelta, type Delta } from "./rates";
import { formatDuration, type Distribution } from "./response-time";

export type KpiTrend = "good" | "bad" | "flat";

export type Kpi = {
  key: "requests" | "runs" | "dms" | "button" | "failures" | "latency";
  label: string;
  /** Texto já pronto: "sem base" quando não há dado. */
  display: string;
  hasValue: boolean;
  caption: string | null;
  deltaText: string;
  /** Nulo quando não há variação para mostrar. */
  trend: KpiTrend | null;
  baseline: string | null;
  alert: boolean;
};

export type KpiInput = {
  comparison: PeriodComparison;
  sources: Sources | null;
  funnel: FunnelCounts | null;
  previousFunnel: FunnelCounts | null;
  currentTotals: Record<string, number> | null;
  previousTotals: Record<string, number> | null;
  latency: Distribution | null;
  previousLatency: Distribution | null;
};

/**
 * Mesma leitura de `readWindow`, para número que vem pronto de outra RPC.
 * Zero antes da primeira observação da fonte é ausência de dado, não zero.
 */
export function readObservedValue(value: number | null, span: SourceSpan | null | undefined, window: TimeBounds): WindowReading {
  if (value === null) return { value: null, coverage: "unknown" };
  const first = span?.first ?? null;
  if (first === null) return { value: value > 0 ? value : null, coverage: "unknown" };
  const firstMs = new Date(first).getTime();
  const coverage = firstMs > new Date(window.startIso).getTime() ? "partial" : "complete";
  if (value === 0 && firstMs >= new Date(window.endIso).getTime()) return { value: null, coverage };
  return { value, coverage };
}

function trendOf(change: Delta, higherIsBetter: boolean): KpiTrend | null {
  if (change.kind !== "value") return null;
  if (Math.round(change.percent) === 0) return "flat";
  return change.percent > 0 === higherIsBetter ? "good" : "bad";
}

type Reading = { current: WindowReading; previous: WindowReading };

function dmsCaptionText(automation: number | null, manual: number | null): string | null {
  if (automation === null && manual === null) return null;
  if (automation !== null && manual !== null) return `${formatCount(automation)} automação, ${formatCount(manual)} Inbox`;
  const part = (value: number | null) => (value === null ? NO_BASE_LABEL : formatCount(value));
  return `automação: ${part(automation)}, Inbox: ${part(manual)}`;
}

function kpi(
  key: Kpi["key"],
  label: string,
  { current, previous }: Reading,
  options: { higherIsBetter: boolean; format?: (value: number) => string; caption?: string | null; alert?: boolean }
): Kpi {
  const format = options.format ?? formatCount;
  const change = windowDelta(current, previous);
  const trend = trendOf(change, options.higherIsBetter);
  return {
    key,
    label,
    display: current.value === null ? NO_BASE_LABEL : format(current.value),
    hasValue: current.value !== null,
    caption: options.caption ?? null,
    deltaText: formatDelta(change),
    trend,
    baseline: trend !== null && previous.value !== null ? format(previous.value) : null,
    alert: options.alert ?? false,
  };
}

export function buildKpis(input: KpiInput): Kpi[] {
  const { comparison, sources, funnel, previousFunnel, currentTotals, previousTotals, latency, previousLatency } = input;

  const fromFunnel = (pick: (counts: FunnelCounts) => number, span: SourceSpan | undefined): Reading => ({
    current: readObservedValue(funnel ? pick(funnel) : null, span, comparison.current),
    previous: readObservedValue(previousFunnel ? pick(previousFunnel) : null, span, comparison.previous),
  });
  const fromWindows = (kinds: EventKind[]): Reading => ({
    current: readCombinedWindow(kinds, currentTotals, comparison.current, sources),
    previous: readCombinedWindow(kinds, previousTotals, comparison.previous, sources),
  });
  const latencyReading: Reading = {
    current: readObservedValue(latency?.p50 ?? null, sources?.comments, comparison.current),
    previous: readObservedValue(previousLatency?.p50 ?? null, sources?.comments, comparison.previous),
  };

  const dmsAutomation = readCombinedWindow(["dm_automation"], currentTotals, comparison.current, sources).value;
  const dmsManual = readCombinedWindow(["dm_manual"], currentTotals, comparison.current, sources).value;
  const dmsCaption = dmsCaptionText(dmsAutomation, dmsManual);

  const failures = fromWindows(["failure_run", "failure_message"]);
  const samples = latency?.samples ?? 0;

  return [
    kpi("requests", "Pedidos únicos", fromFunnel((c) => c.requests_unique, sources?.comments), { higherIsBetter: true }),
    kpi("runs", "Disparos", fromWindows(["run_started"]), { higherIsBetter: true }),
    kpi("dms", "DMs enviadas", fromWindows(["dm_automation", "dm_manual"]), { higherIsBetter: true, caption: dmsCaption }),
    kpi("button", "Mensagem com botão", fromFunnel((c) => c.button, sources?.messages_outbound), { higherIsBetter: true }),
    kpi("failures", "Falhas", failures, { higherIsBetter: false, alert: (failures.current.value ?? 0) > 0 }),
    kpi("latency", "Mediana até a 1ª DM", latencyReading, {
      higherIsBetter: false,
      format: formatDuration,
      caption: latency ? `${formatCount(samples)} ${samples === 1 ? "amostra" : "amostras"}` : null,
    }),
  ];
}
