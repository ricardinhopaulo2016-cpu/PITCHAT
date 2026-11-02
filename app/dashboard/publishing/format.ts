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
