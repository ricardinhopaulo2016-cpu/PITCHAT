/**
 * Formatação compartilhada entre Inbox e Contacts. Datas sempre em
 * America/Sao_Paulo (o servidor da Vercel roda em UTC — sem timeZone
 * explícito, "19:03" sairia 3h adiantado pra quem opera no Brasil).
 */
const TZ = "America/Sao_Paulo";

export function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "agora";
  if (minutes < 60) return `${minutes}min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** `19:03` */
export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

/** `26/09/2026` */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { timeZone: TZ });
}

/** `26/09/2026 19:03` */
export function formatDateTime(iso: string): string {
  return `${formatDate(iso)} ${formatClock(iso)}`;
}

/** `26 de set.` — separador de dia da timeline. */
export function formatDayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "numeric", month: "short", timeZone: TZ });
}

/** Chave estável do dia (no fuso de SP) pra detectar troca de dia na timeline. */
export function dayKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}

export function platformLabel(platform: string): string {
  return platform === "instagram" ? "Instagram" : platform;
}

/** Iniciais do fallback de avatar — nunca inventa nada, só reaproveita o username real. */
export function initials(username: string | null): string {
  const clean = (username ?? "").replace(/[^a-zA-Z0-9]/g, "");
  return clean.slice(0, 2).toUpperCase() || "?";
}
