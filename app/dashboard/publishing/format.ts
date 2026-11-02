/** A operação vive no horário de Brasília, independente de onde o servidor roda. */
const TIME_ZONE = "America/Sao_Paulo";

export function formatPostTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    .format(new Date(iso))
    .replace(",", " às");
}

export function formatClock(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** Chave estável do dia em Brasília, para agrupar o calendário. */
export function dayKey(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(new Date(iso));
}

export function formatDayHeading(iso: string, now: Date = new Date()): string {
  const key = dayKey(iso);
  if (key === dayKey(now.toISOString())) return "Hoje";
  if (key === dayKey(new Date(now.getTime() + 24 * 60 * 60_000).toISOString())) return "Amanhã";
  if (key === dayKey(new Date(now.getTime() - 24 * 60 * 60_000).toISOString())) return "Ontem";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: TIME_ZONE, weekday: "long", day: "2-digit", month: "2-digit" }).format(new Date(iso));
}

const WEEKDAY_LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function shiftKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export type WeekDay = { key: string; weekday: string; day: string };

/** Os 7 dias, de segunda a domingo, da semana que contém `reference` (AAAA-MM-DD em Brasília). */
export function weekOf(reference: string): WeekDay[] {
  const [year, month, day] = reference.split("-").map(Number);
  const sinceMonday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
  return WEEKDAY_LABELS.map((weekday, index) => {
    const key = shiftKey(reference, index - sinceMonday);
    return { key, weekday, day: key.slice(8) };
  });
}

/** Mesma data, `weeks` semanas para frente ou para trás. */
export function shiftWeek(reference: string, weeks: number): string {
  return shiftKey(reference, weeks * 7);
}

export function isDayKey(value: string | undefined): value is string {
  return !!value && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}
