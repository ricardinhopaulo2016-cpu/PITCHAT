/**
 * Fotografias das métricas de cada Reel em idades fixas, para comparar ritmo
 * entre posts do mesmo perfil na mesma idade (views e EU QUERO).
 *
 * Métricas conferidas na API real em 10/11/2026 (GET /{media-id}/insights,
 * permissão instagram_business_manage_insights): views, reach, likes,
 * comments, shares, saved, total_interactions, ig_reels_avg_watch_time (ms).
 */

export const SNAPSHOT_AGES_HOURS = [1, 3, 6, 24, 48, 72, 168] as const;
export type SnapshotAge = (typeof SNAPSHOT_AGES_HOURS)[number];

export const REEL_INSIGHT_METRICS = ["views", "reach", "likes", "comments", "shares", "saved", "total_interactions", "ig_reels_avg_watch_time"] as const;

export type ReelInsightValues = {
  views: number | null;
  reach: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  total_interactions: number | null;
  avg_watch_time_ms: number | null;
};

const HOUR_MS = 60 * 60_000;

/** Resposta da Graph API ({ data: [{ name, values: [{ value }] }] }) para os campos da tabela. */
export function parseReelInsights(json: unknown): ReelInsightValues {
  const data = (json as { data?: { name?: string; values?: { value?: unknown }[] }[] } | null)?.data;
  const byName = new Map<string, number>();
  for (const item of Array.isArray(data) ? data : []) {
    const value = item?.values?.[0]?.value;
    if (item?.name && typeof value === "number" && Number.isFinite(value)) byName.set(item.name, value);
  }
  const get = (name: string) => byName.get(name) ?? null;
  return {
    views: get("views"),
    reach: get("reach"),
    likes: get("likes"),
    comments: get("comments"),
    shares: get("shares"),
    saved: get("saved"),
    total_interactions: get("total_interactions"),
    avg_watch_time_ms: get("ig_reels_avg_watch_time"),
  };
}

/**
 * Quanto depois da idade-alvo a foto ainda vale para aquela idade. Foto de
 * "1h" tirada 20h depois não serve para comparar ritmo: melhor faltar.
 */
export function snapshotTolerance(ageHours: number): number {
  return Math.max(1, ageHours * 0.25) * HOUR_MS;
}

/** Idades já vencidas, ainda dentro da tolerância e sem foto. É o que o cron de reserva pega. */
export function dueSnapshotAges(publishedAt: string, now: Date, taken: ReadonlySet<number>): SnapshotAge[] {
  const elapsed = now.getTime() - new Date(publishedAt).getTime();
  return SNAPSHOT_AGES_HOURS.filter((age) => {
    const target = age * HOUR_MS;
    return !taken.has(age) && elapsed >= target && elapsed <= target + snapshotTolerance(age);
  });
}

/** Atraso em segundos, a partir da publicação, para agendar cada foto na fila. */
export function snapshotDelaysSeconds(): { age: SnapshotAge; delaySeconds: number }[] {
  return SNAPSHOT_AGES_HOURS.map((age) => ({ age, delaySeconds: age * 3600 }));
}
