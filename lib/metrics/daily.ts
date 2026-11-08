import { todayKey } from "@/lib/ui/date-range";
import { delta, type Delta } from "./rates";

export type EventKind =
  | "post_published"
  | "comment_valid"
  | "request_unique"
  | "run_started"
  | "dm_automation"
  | "dm_manual"
  | "failure_run"
  | "failure_message";

export type SourceKey = "comments" | "messages_inbound" | "messages_outbound" | "runs" | "posts";
export type SourceSpan = { first: string | null; last: string | null };
export type Sources = Record<SourceKey, SourceSpan>;

export const EVENT_SOURCE: Record<EventKind, SourceKey> = {
  post_published: "posts",
  comment_valid: "comments",
  request_unique: "comments",
  run_started: "runs",
  failure_run: "runs",
  dm_automation: "messages_outbound",
  dm_manual: "messages_outbound",
  failure_message: "messages_outbound",
};

const EVENT_KINDS = Object.keys(EVENT_SOURCE) as EventKind[];

export type RawDaily = { day: string; kind: EventKind; count: number };
export type DailyRow = { day: string; partial: boolean; values: Record<EventKind, number | null> };

/**
 * Dia sem linha só vira 0 se a fonte já observava algo naquele dia. Antes da
 * primeira observação não sabemos, e ausência de dado nunca vira zero.
 */
export function buildDailySeries(rows: RawDaily[], days: string[], sources: Sources | null, today: string): DailyRow[] {
  const counts = new Map(rows.map((row) => [`${row.day}|${row.kind}`, row.count]));

  return days.map((day) => {
    const values = {} as Record<EventKind, number | null>;
    for (const kind of EVENT_KINDS) {
      const present = counts.get(`${day}|${kind}`);
      if (present !== undefined) {
        values[kind] = present;
        continue;
      }
      const first = sources?.[EVENT_SOURCE[kind]].first ?? null;
      values[kind] = first !== null && day >= todayKey(new Date(first)) ? 0 : null;
    }
    return { day, partial: day === today, values };
  });
}

/** Só é 0 de verdade se a fonte já observava algo até o fim do recorte. */
export function isObservedBy(span: SourceSpan | null | undefined, endIso: string): boolean {
  if (!span?.first) return false;
  // Compara instantes: o jsonb do banco vem com "+00:00" e microssegundos, então texto não serve.
  return new Date(span.first).getTime() < new Date(endIso).getTime();
}

/** Contagem vinda de soma no banco: sem observação da fonte, 0 é ausência de dado. */
export function observedCount(value: number, span: SourceSpan | null | undefined, endIso: string): number | null {
  if (value > 0) return value;
  return isObservedBy(span, endIso) ? value : null;
}

export type WindowBounds = { startIso: string; endIso: string };
/** `partial`: a fonte começou a observar depois do início da janela. */
export type WindowCoverage = "complete" | "partial" | "unknown";
export type WindowReading = { value: number | null; coverage: WindowCoverage };

export function readWindow(kind: EventKind, totals: Record<string, number> | null, window: WindowBounds, sources: Sources | null): WindowReading {
  if (totals === null) return { value: null, coverage: "unknown" };
  const present = totals[kind];
  const first = sources?.[EVENT_SOURCE[kind]].first ?? null;
  if (first === null) return { value: present ?? null, coverage: "unknown" };

  const firstMs = new Date(first).getTime();
  const coverage = firstMs > new Date(window.startIso).getTime() ? "partial" : "complete";
  if (present !== undefined) return { value: present, coverage };
  return { value: firstMs < new Date(window.endIso).getTime() ? 0 : null, coverage };
}

/** Soma o que existe. Só é nulo quando nenhum dos lados tem dado. */
export function sumNullable(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  return b === null ? a : a + b;
}

export function failureCount(values: Record<EventKind, number | null>): number | null {
  return sumNullable(values.failure_run, values.failure_message);
}

/** Soma os tipos com dado. A cobertura é a pior entre eles; tipo sem dado não pesa. */
export function readCombinedWindow(kinds: EventKind[], totals: Record<string, number> | null, window: WindowBounds, sources: Sources | null): WindowReading {
  const readings = kinds.map((kind) => readWindow(kind, totals, window, sources)).filter((reading) => reading.value !== null);
  if (readings.length === 0) return { value: null, coverage: "unknown" };
  const coverages = readings.map((reading) => reading.coverage);
  return {
    value: readings.map((reading) => reading.value).reduce<number | null>(sumNullable, null),
    coverage: coverages.includes("unknown") ? "unknown" : coverages.includes("partial") ? "partial" : "complete",
  };
}

/** Janela observada só em parte não sustenta comparação percentual. */
export function windowDelta(current: WindowReading, baseline: WindowReading): Delta {
  if (current.coverage !== "complete" || baseline.coverage !== "complete") return { kind: "no_base" };
  return delta(current.value, baseline.value);
}
