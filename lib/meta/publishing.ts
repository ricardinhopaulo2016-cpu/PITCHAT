import { getGraphApiVersion } from "./api-version";
import { MetaApiError, classifyMetaError } from "./client";

/**
 * Content Publishing da Instagram API with Instagram Login.
 * Fonte: https://developers.facebook.com/docs/instagram-platform/content-publishing/
 * e https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/
 * (lidas em 02/11/2026). Fluxo: POST /{ig-id}/media cria o container, GET
 * /{container}?fields=status_code acompanha o processamento, POST
 * /{ig-id}/media_publish publica. A mídia precisa estar em URL pública.
 */

export type ContainerStatus = "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";

export type CreateContainerParams = {
  accessToken: string;
  igUserId: string;
  mediaType: "REELS" | "STORIES";
  mediaKind: "video" | "image";
  mediaUrl: string;
  caption: string | null;
  shareToFeed: boolean;
};

export interface InstagramPublisher {
  createContainer(params: CreateContainerParams): Promise<{ containerId: string }>;
  getContainerStatus(params: { accessToken: string; containerId: string }): Promise<{ statusCode: ContainerStatus; detail: string | null }>;
  publishContainer(params: { accessToken: string; igUserId: string; containerId: string }): Promise<{ mediaId: string }>;
  getPermalink(params: { accessToken: string; mediaId: string }): Promise<string | null>;
}

const GRAPH_BASE_URL = "https://graph.instagram.com";

async function parseOrThrow(res: Response): Promise<Record<string, unknown>> {
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const error = json.error as { message?: string; error_user_msg?: string; code?: number; error_subcode?: number } | undefined;
    throw new MetaApiError(error?.error_user_msg ?? error?.message ?? `Meta API retornou HTTP ${res.status}`, {
      kind: classifyMetaError(res.status, error?.code),
      code: error?.code,
      subcode: error?.error_subcode,
      httpStatus: res.status,
    });
  }
  return json;
}

async function post(path: string, accessToken: string, body: Record<string, unknown>) {
  const res = await fetch(`${GRAPH_BASE_URL}/${getGraphApiVersion()}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(body),
  });
  return parseOrThrow(res);
}

async function get(path: string, accessToken: string, fields: string) {
  const url = new URL(`${GRAPH_BASE_URL}/${getGraphApiVersion()}${path}`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("access_token", accessToken);
  return parseOrThrow(await fetch(url.toString()));
}

/** Corpo do POST /media. Stories não aceitam legenda nem share_to_feed. */
export function buildContainerBody(params: CreateContainerParams): Record<string, unknown> {
  const body: Record<string, unknown> = { media_type: params.mediaType };
  if (params.mediaKind === "video") body.video_url = params.mediaUrl;
  else body.image_url = params.mediaUrl;
  if (params.mediaType === "REELS") {
    if (params.caption) body.caption = params.caption;
    body.share_to_feed = params.shareToFeed;
  }
  return body;
}

export const realInstagramPublisher: InstagramPublisher = {
  async createContainer(params) {
    const json = await post(`/${params.igUserId}/media`, params.accessToken, buildContainerBody(params));
    if (!json.id) throw new Error("POST /media não devolveu o id do container");
    return { containerId: String(json.id) };
  },

  async getContainerStatus({ accessToken, containerId }) {
    const json = await get(`/${containerId}`, accessToken, "status_code,status");
    return {
      statusCode: json.status_code as ContainerStatus,
      detail: typeof json.status === "string" ? json.status : null,
    };
  },

  async publishContainer({ accessToken, igUserId, containerId }) {
    const json = await post(`/${igUserId}/media_publish`, accessToken, { creation_id: containerId });
    if (!json.id) throw new Error("POST /media_publish não devolveu o id da mídia");
    return { mediaId: String(json.id) };
  },

  async getPermalink({ accessToken, mediaId }) {
    const json = await get(`/${mediaId}`, accessToken, "permalink");
    return typeof json.permalink === "string" ? json.permalink : null;
  },
};
