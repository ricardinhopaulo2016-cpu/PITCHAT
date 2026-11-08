import { formatRange, parseRange, rangeToIso, shiftDay, todayKey, type DateRange } from "@/lib/ui/date-range";
import { DEFAULT_PERIOD_DAYS, MAX_PERIOD_DAYS } from "./constants";

const DAY_MS = 24 * 60 * 60_000;

export type MetricsPeriod = {
  range: DateRange;
  startIso: string;
  endIso: string;
  label: string;
  isDefault: boolean;
  clamped: boolean;
  days: string[];
};

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/** Período da URL em dias de Brasília. Padrão: últimos 7 dias, incluindo hoje. */
export function resolvePeriod(de: string | undefined, ate: string | undefined, now: Date): MetricsPeriod {
  const today = todayKey(now);
  const parsed = parseRange(de, ate);

  let range: DateRange = { from: shiftDay(today, 1 - DEFAULT_PERIOD_DAYS), to: today };
  let clamped = false;

  if (parsed) {
    const to = parsed.to > today ? today : parsed.to;
    let from = parsed.from > today ? today : parsed.from;
    if (daysBetween(from, to).length > MAX_PERIOD_DAYS) {
      from = shiftDay(to, 1 - MAX_PERIOD_DAYS);
      clamped = true;
    }
    range = { from, to };
  }

  const { start, end } = rangeToIso(range);
  return {
    range,
    startIso: start,
    endIso: end,
    label: parsed ? `em ${formatRange(range)}` : "nos últimos 7 dias",
    isDefault: !parsed,
    clamped,
    days: daysBetween(range.from, range.to),
  };
}

export type WindowKey = "today" | "yesterday_same_time" | "yesterday" | "last7" | "previous7";
export type ComparisonWindow = { key: WindowKey; label: string; startIso: string; endIso: string };

function dayStartIso(day: string): string {
  return rangeToIso({ from: day, to: day }).start;
}

/** Janelas fixas do comparativo, independentes do filtro de período. */
export function comparisonWindows(now: Date): ComparisonWindow[] {
  const today = todayKey(now);
  const todayStart = dayStartIso(today);
  const yesterdayStart = dayStartIso(shiftDay(today, -1));
  const sevenDaysAgo = dayStartIso(shiftDay(today, -7));

  return [
    { key: "today", label: "Hoje (parcial)", startIso: todayStart, endIso: now.toISOString() },
    {
      key: "yesterday_same_time",
      label: "Ontem até esta hora",
      startIso: yesterdayStart,
      endIso: new Date(now.getTime() - DAY_MS).toISOString(),
    },
    { key: "yesterday", label: "Ontem inteiro", startIso: yesterdayStart, endIso: todayStart },
    { key: "last7", label: "7 dias completos", startIso: sevenDaysAgo, endIso: todayStart },
    { key: "previous7", label: "7 dias anteriores", startIso: dayStartIso(shiftDay(today, -14)), endIso: sevenDaysAgo },
  ];
}
