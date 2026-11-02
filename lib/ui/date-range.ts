/**
 * Período escolhido no calendário. Vive na URL (`?de=AAAA-MM-DD&ate=AAAA-MM-DD`)
 * e os dias são sempre os de Brasília, onde a operação acontece. O Brasil não
 * tem horário de verão desde 2019, então o deslocamento é fixo.
 */
const BRT_OFFSET = "-03:00";

export const RANGE_FROM_PARAM = "de";
export const RANGE_TO_PARAM = "ate";

export type DateRange = { from: string; to: string };

export function isDayKey(value: string | null | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function shiftDay(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Lê o período da URL. Só um dos lados vira um dia único; ordem invertida é corrigida; lixo vira "sem filtro". */
export function parseRange(from: string | null | undefined, to: string | null | undefined): DateRange | null {
  const validFrom = isDayKey(from) ? from : null;
  const validTo = isDayKey(to) ? to : null;
  if (!validFrom && !validTo) return null;
  const a = validFrom ?? (validTo as string);
  const b = validTo ?? a;
  return a <= b ? { from: a, to: b } : { from: b, to: a };
}

/** Limites para consultar o banco: `gte(start)` e `lt(end)`, com o fim já no dia seguinte. */
export function rangeToIso(range: DateRange): { start: string; end: string } {
  return {
    start: new Date(`${range.from}T00:00:00${BRT_OFFSET}`).toISOString(),
    end: new Date(`${shiftDay(range.to, 1)}T00:00:00${BRT_OFFSET}`).toISOString(),
  };
}

function short(key: string): string {
  return `${key.slice(8)}/${key.slice(5, 7)}`;
}

export function formatRange(range: DateRange): string {
  if (range.from === range.to) return `${short(range.from)}/${range.from.slice(0, 4)}`;
  return `${short(range.from)} a ${short(range.to)}/${range.to.slice(0, 4)}`;
}

export function todayKey(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

export type RangePreset = { label: string; range: DateRange };

export function rangePresets(today: string): RangePreset[] {
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthEnd = shiftDay(monthStart, -1);
  return [
    { label: "Hoje", range: { from: today, to: today } },
    { label: "Ontem", range: { from: shiftDay(today, -1), to: shiftDay(today, -1) } },
    { label: "Últimos 7 dias", range: { from: shiftDay(today, -6), to: today } },
    { label: "Últimos 30 dias", range: { from: shiftDay(today, -29), to: today } },
    { label: "Este mês", range: { from: monthStart, to: today } },
    { label: "Mês passado", range: { from: `${lastMonthEnd.slice(0, 8)}01`, to: lastMonthEnd } },
  ];
}

/** As semanas do mês (`AAAA-MM`), de segunda a domingo, com os dias vizinhos completando as pontas. */
export function monthGrid(month: string): string[][] {
  const first = `${month}-01`;
  const [year, monthNumber] = month.split("-").map(Number);
  const sinceMonday = (new Date(Date.UTC(year, monthNumber - 1, 1)).getUTCDay() + 6) % 7;
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  const weeks: string[][] = [];
  for (let start = -sinceMonday; start < lastDay; start += 7) {
    weeks.push(Array.from({ length: 7 }, (_, index) => shiftDay(first, start + index)));
  }
  return weeks;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthNumber - 1 + delta, 1)).toISOString().slice(0, 7);
}
