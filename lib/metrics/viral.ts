import { GOAL_PER_POST, REEL_MATURE_AGE_DAYS, REELS_FOR_BASELINE } from "./constants";

export type ViralStatus = "insufficient" | "waiting_real_time";

export type RawViralAccount = { social_account_id: string; username: string | null; mature_reels: number };

export type ViralAccount = {
  accountId: string;
  username: string | null;
  mature: number;
  target: number;
  progress: number;
  status: ViralStatus;
};

/** Mesmo com a base completa não há previsão: falta o horário real do comentário. */
export function buildViralAccounts(rows: RawViralAccount[]): ViralAccount[] {
  return rows.map((row) => ({
    accountId: row.social_account_id,
    username: row.username,
    mature: row.mature_reels,
    target: REELS_FOR_BASELINE,
    progress: Math.min(1, row.mature_reels / REELS_FOR_BASELINE),
    status: row.mature_reels < REELS_FOR_BASELINE ? "insufficient" : "waiting_real_time",
  }));
}

export type RawTopPost = {
  social_account_id: string;
  external_media_id: string;
  requests_unique: number;
  permalink: string | null;
};

export type GoalPost = { accountId: string; mediaId: string; permalink: string | null; requests: number; progress: number };

export function buildGoalPosts(rows: RawTopPost[]): GoalPost[] {
  return rows.map((row) => ({
    accountId: row.social_account_id,
    mediaId: row.external_media_id,
    permalink: row.permalink,
    requests: row.requests_unique,
    progress: Math.min(1, row.requests_unique / GOAL_PER_POST),
  }));
}

export function matureBeforeIso(now: Date): string {
  return new Date(now.getTime() - REEL_MATURE_AGE_DAYS * 24 * 60 * 60_000).toISOString();
}

export type RawViral = { accounts: RawViralAccount[]; top_posts: RawTopPost[] };
