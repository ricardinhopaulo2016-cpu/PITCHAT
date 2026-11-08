import { MEDIAN_MIN_SAMPLES, NO_BASE_LABEL, P95_MIN_SAMPLES } from "./constants";

export const COMMENT_TIME_UNAVAILABLE = "horário do comentário indisponível";

export type Distribution = { samples: number; p50: number | null; p95: number | null };

/** Com poucas amostras o percentil não diz nada: fica nulo e a tela mostra "sem base". */
export function toDistribution(samples: number | null, p50: number | null, p95: number | null): Distribution {
  const n = samples ?? 0;
  return { samples: n, p50: n >= MEDIAN_MIN_SAMPLES ? p50 : null, p95: n >= P95_MIN_SAMPLES ? p95 : null };
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null) return NO_BASE_LABEL;
  const total = Math.max(0, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const rest = total % 60;
    return rest > 0 ? `${Math.floor(total / 60)}min ${rest}s` : `${Math.floor(total / 60)}min`;
  }
  const minutes = Math.floor((total % 3600) / 60);
  return minutes > 0 ? `${Math.floor(total / 3600)}h ${minutes}min` : `${Math.floor(total / 3600)}h`;
}

type RawPercentiles = { p50_seconds: number | null; p95_seconds: number | null };

export type RawResponseTimes = {
  internal: RawPercentiles & { samples: number };
  internal_by_account: (RawPercentiles & { social_account_id: string; samples: number })[];
  human: RawPercentiles & { conversations_with_inbound: number; answered: number };
};
