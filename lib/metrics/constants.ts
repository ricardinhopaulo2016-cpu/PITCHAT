/** A meta da operação: 1.000 EU QUERO por post. */
export const GOAL_PER_POST = 1000;
export const GOAL_PHRASE = "eu quero";

export const DEFAULT_PERIOD_DAYS = 7;
export const MAX_PERIOD_DAYS = 92;

/** Reel publicado há pelo menos esse tempo entra na base do perfil. */
export const REEL_MATURE_AGE_DAYS = 7;
export const REELS_FOR_BASELINE = 30;
export const VIRAL_SIGNAL_MULTIPLIER = 3;

export const MEDIAN_MIN_SAMPLES = 3;
export const P95_MIN_SAMPLES = 20;

export const FUNNEL_POST_LIMIT = 50;
export const INCIDENT_LIMIT = 50;
export const TOP_GOAL_POSTS = 5;
export const MAX_INSIGHTS = 6;

/** Abaixo do limite da função serverless: uma RPC lenta cai sozinha, sem derrubar a página. */
export const RPC_TIMEOUT_MS = 8_000;
/** A base de viralização lê todo o histórico e muda devagar. */
export const VIRAL_CACHE_TTL_MS = 5 * 60_000;

export const NO_BASE_LABEL = "sem base";
export const NO_DATA_LABEL = "sem dado";
