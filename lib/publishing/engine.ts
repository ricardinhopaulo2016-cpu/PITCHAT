import { MetaApiError } from "@/lib/meta/client";
import type { InstagramPublisher } from "@/lib/meta/publishing";

/**
 * Máquina de estados de um post. Cada chamada avança um passo e agenda a
 * próxima, porque processar vídeo na Meta leva minutos e não cabe numa request.
 *
 * scheduled -> processing (cria container) -> acompanha status -> published
 *
 * Nunca publica duas vezes: publish_attempted_at é gravado antes do
 * media_publish, e o container guarda se já foi publicado (status PUBLISHED).
 * Se a resposta da Meta se perder, o próximo passo descobre por ali.
 */

export type PostStatus = "scheduled" | "processing" | "published" | "failed" | "canceled";

export type PostRecord = {
  id: string;
  social_account_id: string;
  media_asset_id: string;
  media_type: "REELS" | "STORIES";
  caption: string | null;
  share_to_feed: boolean;
  scheduled_at: string;
  status: PostStatus;
  container_id: string | null;
  publish_attempted_at: string | null;
  attempts: number;
  status_checks: number;
};

export type PostPatch = Partial<{
  status: PostStatus;
  container_id: string | null;
  publish_attempted_at: string | null;
  external_media_id: string | null;
  permalink: string | null;
  attempts: number;
  status_checks: number;
  last_error: PublishError | null;
  published_at: string | null;
}>;

export type PublishError = { reason: string; message?: string; code?: number; subcode?: number };

export type AdvanceDeps = {
  loadPost(id: string): Promise<PostRecord | null>;
  /** Passa de scheduled para processing só se ainda estiver scheduled. false = outro worker pegou ou foi cancelado. */
  claimPost(id: string): Promise<boolean>;
  updatePost(id: string, patch: PostPatch): Promise<void>;
  getAccount(socialAccountId: string): Promise<{ igUserId: string; accessToken: string } | null>;
  getMedia(mediaAssetId: string): Promise<{ url: string; kind: "video" | "image" } | null>;
  schedule(postId: string, delaySeconds: number, dedupeKey: string): Promise<void>;
  /** Roda depois que o post virou "published". Falhar aqui nunca muda o resultado: o post já saiu. */
  onPublished?(post: PostRecord): Promise<void>;
  publisher: InstagramPublisher;
  now(): Date;
};

export const FIRST_CHECK_DELAY_SECONDS = 30;
export const CHECK_INTERVAL_SECONDS = 60;
/** A doc recomenda 1 consulta por minuto por até 5 minutos; vídeo longo pode levar mais, então há folga. */
export const MAX_STATUS_CHECKS = 20;
export const MAX_ATTEMPTS = 5;
/** Horário perdido por mais que isso vira erro visível, em vez de postar fora de hora sem ninguém saber. */
export const LATE_TOLERANCE_MS = 2 * 60 * 60_000;
/** Teto de atraso que o QStash aceita com folga; além disso o varredor diário enfileira. */
export const MAX_QUEUE_DELAY_SECONDS = 6 * 24 * 60 * 60;

export type AdvanceOutcome =
  | "not_found"
  | "already_final"
  | "too_early"
  | "not_claimed"
  | "container_created"
  | "still_processing"
  | "published"
  | "retry_scheduled"
  | "failed";

export async function advanceScheduledPost(deps: AdvanceDeps, postId: string): Promise<AdvanceOutcome> {
  const post = await deps.loadPost(postId);
  if (!post) return "not_found";
  if (post.status === "published" || post.status === "failed" || post.status === "canceled") return "already_final";

  if (post.status === "scheduled") {
    const msUntilDue = new Date(post.scheduled_at).getTime() - deps.now().getTime();
    if (msUntilDue > 30_000) {
      const seconds = Math.ceil(msUntilDue / 1000);
      if (seconds <= MAX_QUEUE_DELAY_SECONDS) await deps.schedule(post.id, seconds, startKey(post));
      return "too_early";
    }
    if (-msUntilDue > LATE_TOLERANCE_MS) return fail(deps, post, { reason: "MISSED_WINDOW" });
    if (!(await deps.claimPost(post.id))) return "not_claimed";
  }

  try {
    const account = await deps.getAccount(post.social_account_id);
    if (!account) return await fail(deps, post, { reason: "ACCOUNT_NOT_CONNECTED" });
    return post.container_id
      ? await checkAndPublish(deps, post, post.container_id, account)
      : await createContainer(deps, post, account);
  } catch (err) {
    return handleError(deps, post, err);
  }
}

async function createContainer(deps: AdvanceDeps, post: PostRecord, account: { igUserId: string; accessToken: string }): Promise<AdvanceOutcome> {
  const media = await deps.getMedia(post.media_asset_id);
  if (!media) return fail(deps, post, { reason: "MEDIA_NOT_FOUND" });

  const { containerId } = await deps.publisher.createContainer({
    accessToken: account.accessToken,
    igUserId: account.igUserId,
    mediaType: post.media_type,
    mediaKind: media.kind,
    mediaUrl: media.url,
    caption: post.caption,
    shareToFeed: post.share_to_feed,
  });

  await deps.updatePost(post.id, { container_id: containerId, status_checks: 0 });
  await deps.schedule(post.id, FIRST_CHECK_DELAY_SECONDS, `${post.id}-check-0-${containerId}`);
  return "container_created";
}

async function checkAndPublish(
  deps: AdvanceDeps,
  post: PostRecord,
  containerId: string,
  account: { igUserId: string; accessToken: string }
): Promise<AdvanceOutcome> {
  const { statusCode, detail } = await deps.publisher.getContainerStatus({ accessToken: account.accessToken, containerId });

  if (statusCode === "IN_PROGRESS") {
    const checks = post.status_checks + 1;
    if (checks >= MAX_STATUS_CHECKS) return fail(deps, post, { reason: "PROCESSING_TIMEOUT" });
    await deps.updatePost(post.id, { status_checks: checks });
    await deps.schedule(post.id, CHECK_INTERVAL_SECONDS, `${post.id}-check-${checks}-${containerId}`);
    return "still_processing";
  }

  // A resposta anterior do media_publish se perdeu, mas o post saiu.
  if (statusCode === "PUBLISHED") {
    await deps.updatePost(post.id, { status: "published", published_at: deps.now().toISOString(), last_error: null });
    await notifyPublished(deps, post);
    return "published";
  }

  if (statusCode === "FINISHED") {
    await deps.updatePost(post.id, { publish_attempted_at: deps.now().toISOString() });
    const { mediaId } = await deps.publisher.publishContainer({ accessToken: account.accessToken, igUserId: account.igUserId, containerId });
    // Sem link o post continua publicado: falha aqui não pode virar erro nem repetição.
    const permalink = await deps.publisher.getPermalink({ accessToken: account.accessToken, mediaId }).catch(() => null);
    await deps.updatePost(post.id, {
      status: "published",
      external_media_id: mediaId,
      permalink,
      published_at: deps.now().toISOString(),
      last_error: null,
    });
    await notifyPublished(deps, post);
    return "published";
  }

  return fail(deps, post, { reason: statusCode === "EXPIRED" ? "CONTAINER_EXPIRED" : "CONTAINER_ERROR", message: detail ?? undefined });
}

/** O post já saiu: nada que o gancho faça (ou deixe de fazer) pode virar erro nem repetição do passo. */
async function notifyPublished(deps: AdvanceDeps, post: PostRecord): Promise<void> {
  try {
    await deps.onPublished?.(post);
  } catch (err) {
    console.error(
      JSON.stringify({ event: "post_published_hook_failed", postId: post.id, message: err instanceof Error ? err.message : String(err) })
    );
  }
}

async function handleError(deps: AdvanceDeps, post: PostRecord, err: unknown): Promise<AdvanceOutcome> {
  const isMeta = err instanceof MetaApiError;
  // Erro fora da Meta (rede, por exemplo) é transitório; a Meta classifica os dela.
  const retryable = isMeta ? err.kind === "RETRYABLE" : true;
  const error: PublishError = {
    reason: isMeta ? "META_API_ERROR" : "UNEXPECTED_ERROR",
    message: err instanceof Error ? err.message : String(err),
    ...(isMeta ? { code: err.code, subcode: err.subcode } : {}),
  };
  const attempts = post.attempts + 1;
  if (!retryable || attempts >= MAX_ATTEMPTS) return fail(deps, post, error);

  await deps.updatePost(post.id, { attempts, last_error: error });
  await deps.schedule(post.id, CHECK_INTERVAL_SECONDS * attempts, `${post.id}-retry-${attempts}`);
  return "retry_scheduled";
}

async function fail(deps: AdvanceDeps, post: PostRecord, error: PublishError): Promise<AdvanceOutcome> {
  await deps.updatePost(post.id, { status: "failed", last_error: error });
  return "failed";
}

export function startKey(post: { id: string; scheduled_at: string }): string {
  return `${post.id}-start-${new Date(post.scheduled_at).getTime()}`;
}

/**
 * Tentar de novo depois de um erro. Se o media_publish chegou a ser chamado,
 * mantém o container: o status dele diz se o post saiu, e assim nunca duplica.
 */
export function retryPatch(post: { publish_attempted_at: string | null }, now: Date) {
  return {
    status: "scheduled" as const,
    scheduled_at: now.toISOString(),
    attempts: 0,
    status_checks: 0,
    last_error: null,
    ...(post.publish_attempted_at ? {} : { container_id: null }),
  };
}
