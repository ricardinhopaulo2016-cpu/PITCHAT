import type { SupabaseClient } from "@supabase/supabase-js";
import { getGraphApi } from "@/lib/meta/client";
import { decryptToken } from "@/lib/meta/token-crypto";
import { parseReelInsights, REEL_INSIGHT_METRICS, SNAPSHOT_AGES_HOURS } from "./reel-snapshots";

export type CaptureOutcome = "captured" | "already_taken" | "not_a_published_reel" | "meta_error" | "no_token";

type PostRow = {
  id: string;
  workspace_id: string;
  social_account_id: string;
  external_media_id: string | null;
  published_at: string | null;
  status: string;
  media_type: string;
  account: { access_token_encrypted: string | null } | null;
};

/**
 * Tira a foto de uma idade de um Reel publicado pelo PITCHAT. Idempotente:
 * a foto daquela idade só existe uma vez (índice único). Erro da Meta
 * (sem permissão, Reel apagado) fica gravado na linha para não insistir.
 */
export async function captureReelSnapshot(admin: SupabaseClient, postId: string, ageHours: number): Promise<CaptureOutcome> {
  if (!(SNAPSHOT_AGES_HOURS as readonly number[]).includes(ageHours)) return "not_a_published_reel";

  const { data: post, error } = await admin
    .from("scheduled_posts")
    .select("id, workspace_id, social_account_id, external_media_id, published_at, status, media_type, account:social_accounts(access_token_encrypted)")
    .eq("id", postId)
    .maybeSingle<PostRow>();
  if (error) throw new Error(`Falha ao carregar post: ${error.message}`);
  if (!post || post.status !== "published" || post.media_type !== "REELS" || !post.external_media_id || !post.published_at) {
    return "not_a_published_reel";
  }

  const { data: existing } = await admin
    .from("reel_insight_snapshots")
    .select("id")
    .eq("social_account_id", post.social_account_id)
    .eq("external_media_id", post.external_media_id)
    .eq("age_hours", ageHours)
    .maybeSingle();
  if (existing) return "already_taken";

  const encrypted = post.account?.access_token_encrypted;
  if (!encrypted) return "no_token";

  const base = {
    workspace_id: post.workspace_id,
    social_account_id: post.social_account_id,
    external_media_id: post.external_media_id,
    published_at: post.published_at,
    age_hours: ageHours,
  };

  let row: Record<string, unknown>;
  let outcome: CaptureOutcome;
  try {
    const json = await getGraphApi(`/${post.external_media_id}/insights?metric=${REEL_INSIGHT_METRICS.join(",")}`, decryptToken(encrypted), { timeoutMs: 15_000 });
    row = { ...base, ...parseReelInsights(json) };
    outcome = "captured";
  } catch (err) {
    row = { ...base, error: (err instanceof Error ? err.message : String(err)).slice(0, 300) };
    outcome = "meta_error";
  }

  const { error: insertError } = await admin
    .from("reel_insight_snapshots")
    .upsert(row, { onConflict: "social_account_id,external_media_id,age_hours", ignoreDuplicates: true });
  if (insertError) throw new Error(`Falha ao gravar foto: ${insertError.message}`);
  return outcome;
}
