import { buildHref } from "@/lib/channel/url";
import { formatRange, parseRange, RANGE_FROM_PARAM, RANGE_TO_PARAM, rangeToIso, shiftDay, todayKey, type DateRange } from "@/lib/ui/date-range";
import { DEFAULT_PERIOD_DAYS, MAX_PERIOD_DAYS } from "./constants";

const DAY_MS = 24 * 60 * 60_000;

export const PERIOD_PARAM = "periodo";

export type PeriodShortcut = "hoje" | "ontem" | "3d" | "7d";
export type PeriodChoice = PeriodShortcut | "personalizado";

export const PERIOD_SHORTCUTS: readonly { key: PeriodShortcut; label: string }[] = [
  { key: "hoje", label: "Hoje" },
  { key: "ontem", label: "Ontem" },
  { key: "3d", label: "Últimos 3 dias" },
  { key: "7d", label: "Últimos 7 dias" },
];

export type MetricsPeriod = {
  range: DateRange;
  startIso: string;
  endIso: string;
  label: string;
  /** Qual botão do filtro corresponde a este período. */
  choice: PeriodChoice;
  isDefault: boolean;
  clamped: boolean;
  days: string[];
};

function daysBetween(from: string, to: string): string[] {
  const days: string[] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) days.push(day);
  return days;
}

function parseShortcut(raw: string | string[] | undefined): PeriodShortcut | null {
  return PERIOD_SHORTCUTS.find((shortcut) => shortcut.key === raw)?.key ?? null;
}

function shortcutPeriod(shortcut: PeriodShortcut, today: string): { range: DateRange; label: string } {
  if (shortcut === "hoje") return { range: { from: today, to: today }, label: "hoje" };
  if (shortcut === "ontem") {
    const yesterday = shiftDay(today, -1);
    return { range: { from: yesterday, to: yesterday }, label: "ontem" };
  }
  const days = shortcut === "3d" ? 3 : DEFAULT_PERIOD_DAYS;
  return { range: { from: shiftDay(today, 1 - days), to: today }, label: `nos últimos ${days} dias` };
}

function buildPeriod(range: DateRange, label: string, choice: PeriodChoice, clamped: boolean): MetricsPeriod {
  const { start, end } = rangeToIso(range);
  return { range, startIso: start, endIso: end, label, choice, isDefault: choice === "7d", clamped, days: daysBetween(range.from, range.to) };
}

/**
 * Período da URL em dias de Brasília. `?periodo=` (atalho) vence `?de=&ate=`;
 * sem nenhum dos dois, ou com lixo, vale o padrão: últimos 7 dias, incluindo hoje.
 */
export function resolvePeriod(de: string | undefined, ate: string | undefined, now: Date, periodo?: string | string[]): MetricsPeriod {
  const today = todayKey(now);
  const parsed = parseRange(de, ate);
  const shortcut = parseShortcut(periodo) ?? (parsed ? null : "7d");

  if (shortcut || !parsed) {
    const { range, label } = shortcutPeriod(shortcut ?? "7d", today);
    return buildPeriod(range, label, shortcut ?? "7d", false);
  }

  const to = parsed.to > today ? today : parsed.to;
  let from = parsed.from > today ? today : parsed.from;
  let clamped = false;
  if (daysBetween(from, to).length > MAX_PERIOD_DAYS) {
    from = shiftDay(to, 1 - MAX_PERIOD_DAYS);
    clamped = true;
  }
  const range = { from, to };
  return buildPeriod(range, `em ${formatRange(range)}`, "personalizado", clamped);
}

function withoutPeriodParams(current: URLSearchParams): URLSearchParams {
  const params = new URLSearchParams(current);
  params.delete(PERIOD_PARAM);
  params.delete(RANGE_FROM_PARAM);
  params.delete(RANGE_TO_PARAM);
  return params;
}

/** Troca só o período: `channel`, `run` e os demais parâmetros continuam na URL. */
export function shortcutHref(pathname: string, current: URLSearchParams, shortcut: PeriodShortcut): string {
  const params = withoutPeriodParams(current);
  params.set(PERIOD_PARAM, shortcut);
  return buildHref(pathname, params);
}

export function customRangeHref(pathname: string, current: URLSearchParams, from: string, to: string): string {
  const params = withoutPeriodParams(current);
  params.set(RANGE_FROM_PARAM, from);
  params.set(RANGE_TO_PARAM, to);
  return buildHref(pathname, params);
}

export type TimeBounds = { startIso: string; endIso: string };
export type PeriodComparison = { current: TimeBounds; previous: TimeBounds; label: string };

function comparisonLabel(period: MetricsPeriod, includesToday: boolean): string {
  if (period.choice === "hoje") return "ontem até esta hora";
  if (period.choice === "ontem") return "anteontem";
  const base = period.days.length === 1 ? "o dia anterior" : `os ${period.days.length} dias anteriores`;
  return includesToday ? `${base}, até a mesma hora` : base;
}

/**
 * Janela anterior de mesmo tamanho, deslocada dia a dia. Se o período inclui
 * hoje, a atual termina agora e a anterior na mesma hora, para não comparar
 * dia em andamento com dia fechado.
 */
export function periodComparison(period: MetricsPeriod, now: Date): PeriodComparison {
  const endMs = new Date(period.endIso).getTime();
  const includesToday = endMs > now.getTime();
  const currentEnd = includesToday ? now.getTime() : endMs;
  const span = period.days.length * DAY_MS;
  return {
    current: { startIso: period.startIso, endIso: new Date(currentEnd).toISOString() },
    previous: {
      startIso: new Date(new Date(period.startIso).getTime() - span).toISOString(),
      endIso: new Date(currentEnd - span).toISOString(),
    },
    label: comparisonLabel(period, includesToday),
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
