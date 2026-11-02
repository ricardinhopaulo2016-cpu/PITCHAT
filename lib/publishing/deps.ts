import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptToken } from "@/lib/meta/token-crypto";
import { realInstagramPublisher } from "@/lib/meta/publishing";
import { schedulePostAdvance } from "@/lib/qstash";
import type { AdvanceDeps, PostRecord } from "./engine";
import { mediaKindOf } from "./validate";

/** A URL assinada só precisa durar até a Meta baixar o arquivo; 6h cobre fila e reprocessamento. */
const MEDIA_URL_TTL_SECONDS = 6 * 60 * 60;

const POST_COLUMNS =
  "id, social_account_id, media_asset_id, media_type, caption, share_to_feed, scheduled_at, status, container_id, publish_attempted_at, attempts, status_checks";

export function buildAdvanceDeps(admin: SupabaseClient): AdvanceDeps {
  return {
    publisher: realInstagramPublisher,
    now: () => new Date(),

    async loadPost(id) {
      const { data, error } = await admin.from("scheduled_posts").select(POST_COLUMNS).eq("id", id).maybeSingle<PostRecord>();
      if (error) throw new Error(`Falha ao carregar post: ${error.message}`);
      return data;
    },

    async claimPost(id) {
      const { data, error } = await admin
        .from("scheduled_posts")
        .update({ status: "processing", updated_at: new Date().toISOString() })
        .eq("id", id)
        .eq("status", "scheduled")
        .select("id");
      if (error) throw new Error(`Falha ao reivindicar post: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async updatePost(id, patch) {
      const { error } = await admin
        .from("scheduled_posts")
        .update({ ...patch, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw new Error(`Falha ao atualizar post: ${error.message}`);
    },

    async getAccount(socialAccountId) {
      const { data } = await admin
        .from("social_accounts")
        .select("external_account_id, access_token_encrypted, status")
        .eq("id", socialAccountId)
        .maybeSingle();
      if (!data?.access_token_encrypted || data.status !== "connected") return null;
      return { igUserId: data.external_account_id, accessToken: decryptToken(data.access_token_encrypted) };
    },

    async getMedia(mediaAssetId) {
      const { data } = await admin.from("media_assets").select("storage_key, mime_type").eq("id", mediaAssetId).maybeSingle();
      const kind = mediaKindOf(data?.mime_type ?? null);
      if (!data || !kind) return null;
      const { data: signed, error } = await admin.storage.from("media").createSignedUrl(data.storage_key, MEDIA_URL_TTL_SECONDS);
      if (error || !signed) throw new Error(`Falha ao assinar a URL da mídia: ${error?.message}`);
      return { url: signed.signedUrl, kind };
    },

    async schedule(postId, delaySeconds, dedupeKey) {
      const result = await schedulePostAdvance({ postId, delaySeconds, deduplicationId: dedupeKey });
      if (!result.ok) throw new Error(`Falha ao enfileirar o post: ${result.reason}`);
    },
  };
}
