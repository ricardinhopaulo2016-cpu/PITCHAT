import { describe, expect, it, vi } from "vitest";
import { MetaApiError } from "@/lib/meta/client";
import { buildContainerBody, type InstagramPublisher } from "@/lib/meta/publishing";
import { advanceScheduledPost, retryPatch, MAX_ATTEMPTS, MAX_STATUS_CHECKS, type AdvanceDeps, type PostPatch, type PostRecord } from "@/lib/publishing/engine";
import { accountCanPublish, collides, validateAssetForPublishing } from "@/lib/publishing/validate";
import { friendlyPublishError } from "@/lib/publishing/messages";

const NOW = new Date("2026-11-02T12:00:00Z");

function makePost(overrides: Partial<PostRecord> = {}): PostRecord {
  return {
    id: "post-1",
    social_account_id: "acc-1",
    media_asset_id: "asset-1",
    media_type: "REELS",
    caption: "Comenta EU QUERO",
    share_to_feed: true,
    scheduled_at: NOW.toISOString(),
    status: "scheduled",
    container_id: null,
    publish_attempted_at: null,
    attempts: 0,
    status_checks: 0,
    ...overrides,
  };
}

function makeDeps(post: PostRecord | null, publisher: Partial<InstagramPublisher> = {}) {
  const patches: PostPatch[] = [];
  const scheduled: { delay: number; key: string }[] = [];
  const pub: InstagramPublisher = {
    createContainer: vi.fn().mockResolvedValue({ containerId: "c-1" }),
    getContainerStatus: vi.fn().mockResolvedValue({ statusCode: "FINISHED", detail: null }),
    publishContainer: vi.fn().mockResolvedValue({ mediaId: "m-1" }),
    getPermalink: vi.fn().mockResolvedValue("https://instagram.com/reel/x"),
    ...publisher,
  };
  const deps: AdvanceDeps = {
    publisher: pub,
    now: () => NOW,
    loadPost: vi.fn().mockResolvedValue(post),
    claimPost: vi.fn().mockResolvedValue(true),
    updatePost: vi.fn(async (_id, patch) => {
      patches.push(patch);
    }),
    getAccount: vi.fn().mockResolvedValue({ igUserId: "ig-1", accessToken: "token" }),
    getMedia: vi.fn().mockResolvedValue({ url: "https://storage/x.mp4", kind: "video" }),
    schedule: vi.fn(async (_id, delay, key) => {
      scheduled.push({ delay, key });
    }),
  };
  return { deps, patches, scheduled, pub };
}

const merged = (patches: PostPatch[]) => Object.assign({}, ...patches) as PostPatch;

describe("advanceScheduledPost", () => {
  it("post devido: reivindica, cria container e agenda a checagem", async () => {
    const { deps, patches, scheduled, pub } = makeDeps(makePost());
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("container_created");
    expect(deps.claimPost).toHaveBeenCalledWith("post-1");
    expect(pub.createContainer).toHaveBeenCalledWith(expect.objectContaining({ mediaType: "REELS", mediaUrl: "https://storage/x.mp4", caption: "Comenta EU QUERO" }));
    expect(merged(patches).container_id).toBe("c-1");
    expect(scheduled).toHaveLength(1);
  });

  it("antes da hora: reagenda sem tocar na Meta", async () => {
    const post = makePost({ scheduled_at: new Date(NOW.getTime() + 3_600_000).toISOString() });
    const { deps, scheduled, pub } = makeDeps(post);
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("too_early");
    expect(scheduled[0].delay).toBe(3600);
    expect(pub.createContainer).not.toHaveBeenCalled();
    expect(deps.claimPost).not.toHaveBeenCalled();
  });

  it("horário perdido há mais de 2h: vira erro e nada é postado", async () => {
    const post = makePost({ scheduled_at: new Date(NOW.getTime() - 3 * 3_600_000).toISOString() });
    const { deps, patches, pub } = makeDeps(post);
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("failed");
    expect(merged(patches).last_error?.reason).toBe("MISSED_WINDOW");
    expect(pub.createContainer).not.toHaveBeenCalled();
  });

  it("cancelado no meio do caminho: outro worker ou o cancelamento vence", async () => {
    const { deps, pub } = makeDeps(makePost());
    deps.claimPost = vi.fn().mockResolvedValue(false);
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("not_claimed");
    expect(pub.createContainer).not.toHaveBeenCalled();
  });

  it.each(["published", "failed", "canceled"] as const)("status final %s: não faz nada", async (status) => {
    const { deps, pub } = makeDeps(makePost({ status, container_id: "c-1" }));
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("already_final");
    expect(pub.getContainerStatus).not.toHaveBeenCalled();
  });

  it("vídeo em processamento: continua checando", async () => {
    const { deps, patches, scheduled, pub } = makeDeps(makePost({ status: "processing", container_id: "c-1", status_checks: 2 }), {
      getContainerStatus: vi.fn().mockResolvedValue({ statusCode: "IN_PROGRESS", detail: null }),
    });
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("still_processing");
    expect(merged(patches).status_checks).toBe(3);
    expect(scheduled).toHaveLength(1);
    expect(pub.publishContainer).not.toHaveBeenCalled();
  });

  it("processamento sem fim: para e mostra o erro", async () => {
    const { deps, patches } = makeDeps(makePost({ status: "processing", container_id: "c-1", status_checks: MAX_STATUS_CHECKS - 1 }), {
      getContainerStatus: vi.fn().mockResolvedValue({ statusCode: "IN_PROGRESS", detail: null }),
    });
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("failed");
    expect(merged(patches).last_error?.reason).toBe("PROCESSING_TIMEOUT");
  });

  it("pronto: marca a tentativa antes de publicar e guarda o link", async () => {
    const { deps, patches, pub } = makeDeps(makePost({ status: "processing", container_id: "c-1" }));
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("published");
    expect(patches[0].publish_attempted_at).toBeTruthy();
    expect(pub.publishContainer).toHaveBeenCalledTimes(1);
    expect(merged(patches)).toMatchObject({ status: "published", external_media_id: "m-1", permalink: "https://instagram.com/reel/x" });
  });

  it("falha só no link: o post continua publicado", async () => {
    const { deps, patches } = makeDeps(makePost({ status: "processing", container_id: "c-1" }), {
      getPermalink: vi.fn().mockRejectedValue(new Error("rede")),
    });
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("published");
    expect(merged(patches)).toMatchObject({ status: "published", permalink: null });
  });

  it("nunca publica de novo: container já PUBLISHED só atualiza o status", async () => {
    const { deps, patches, pub } = makeDeps(makePost({ status: "processing", container_id: "c-1", publish_attempted_at: NOW.toISOString() }), {
      getContainerStatus: vi.fn().mockResolvedValue({ statusCode: "PUBLISHED", detail: null }),
    });
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("published");
    expect(pub.publishContainer).not.toHaveBeenCalled();
    expect(merged(patches).status).toBe("published");
  });

  it.each([
    ["ERROR", "CONTAINER_ERROR"],
    ["EXPIRED", "CONTAINER_EXPIRED"],
  ] as const)("container %s vira erro visível", async (statusCode, reason) => {
    const { deps, patches } = makeDeps(makePost({ status: "processing", container_id: "c-1" }), {
      getContainerStatus: vi.fn().mockResolvedValue({ statusCode, detail: "motivo da Meta" }),
    });
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("failed");
    expect(merged(patches).last_error).toMatchObject({ reason, message: "motivo da Meta" });
  });

  it("erro transitório da Meta: tenta de novo mantendo o container", async () => {
    const { deps, patches, scheduled } = makeDeps(makePost({ status: "processing", container_id: "c-1" }), {
      publishContainer: vi.fn().mockRejectedValue(new MetaApiError("limite", { kind: "RETRYABLE", code: 4, httpStatus: 429 })),
    });
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("retry_scheduled");
    expect(merged(patches).attempts).toBe(1);
    expect(merged(patches).container_id).toBeUndefined();
    expect(scheduled).toHaveLength(1);
  });

  it("erro definitivo da Meta: para na hora com o código", async () => {
    const { deps, patches, scheduled } = makeDeps(makePost(), {
      createContainer: vi.fn().mockRejectedValue(new MetaApiError("sem permissão", { kind: "NON_RETRYABLE", code: 10, httpStatus: 403 })),
    });
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("failed");
    expect(merged(patches).last_error).toMatchObject({ reason: "META_API_ERROR", code: 10, message: "sem permissão" });
    expect(scheduled).toHaveLength(0);
  });

  it("erro transitório repetido: desiste no limite de tentativas", async () => {
    const { deps, patches } = makeDeps(makePost({ status: "processing", attempts: MAX_ATTEMPTS - 1 }), {
      createContainer: vi.fn().mockRejectedValue(new Error("rede")),
    });
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("failed");
    expect(merged(patches).status).toBe("failed");
  });

  it("conta desconectada: erro claro sem chamar a Meta", async () => {
    const { deps, patches, pub } = makeDeps(makePost());
    deps.getAccount = vi.fn().mockResolvedValue(null);
    await expect(advanceScheduledPost(deps, "post-1")).resolves.toBe("failed");
    expect(merged(patches).last_error?.reason).toBe("ACCOUNT_NOT_CONNECTED");
    expect(pub.createContainer).not.toHaveBeenCalled();
  });
});

describe("retryPatch", () => {
  it("sem tentativa de publicar: começa com container novo", () => {
    expect(retryPatch({ publish_attempted_at: null }, NOW)).toMatchObject({ status: "scheduled", container_id: null, attempts: 0 });
  });

  it("publish já tentado: mantém o container para não duplicar", () => {
    expect(retryPatch({ publish_attempted_at: NOW.toISOString() }, NOW)).not.toHaveProperty("container_id");
  });
});

describe("buildContainerBody", () => {
  const base = { accessToken: "t", igUserId: "i", mediaUrl: "https://x", caption: "legenda", shareToFeed: false };

  it("Reel leva vídeo, legenda e share_to_feed", () => {
    expect(buildContainerBody({ ...base, mediaType: "REELS", mediaKind: "video" })).toEqual({
      media_type: "REELS",
      video_url: "https://x",
      caption: "legenda",
      share_to_feed: false,
    });
  });

  it("Story de imagem não leva legenda nem share_to_feed", () => {
    expect(buildContainerBody({ ...base, mediaType: "STORIES", mediaKind: "image" })).toEqual({ media_type: "STORIES", image_url: "https://x" });
  });
});

describe("validateAssetForPublishing", () => {
  const video = { mime_type: "video/mp4", file_size: 50 * 1024 * 1024, duration_ms: 45_000, width: 1080, height: 1920, fps: 30, codec: "h264" };

  it("vídeo 9:16 comum passa como Reel e Story", () => {
    expect(validateAssetForPublishing(video, "REELS")).toEqual({ errors: [], warnings: [] });
    expect(validateAssetForPublishing(video, "STORIES")).toEqual({ errors: [], warnings: [] });
  });

  it("limites diferem entre Reel e Story", () => {
    const long = { ...video, duration_ms: 90_000 };
    expect(validateAssetForPublishing(long, "REELS").errors).toEqual([]);
    expect(validateAssetForPublishing(long, "STORIES").errors).toHaveLength(1);
    const big = { ...video, file_size: 150 * 1024 * 1024 };
    expect(validateAssetForPublishing(big, "REELS").errors).toEqual([]);
    expect(validateAssetForPublishing(big, "STORIES").errors).toHaveLength(1);
  });

  it("recusa vídeo curto, WebM e codec errado", () => {
    expect(validateAssetForPublishing({ ...video, duration_ms: 2_000 }, "REELS").errors).toHaveLength(1);
    expect(validateAssetForPublishing({ ...video, mime_type: "video/webm" }, "REELS").errors).toHaveLength(1);
    expect(validateAssetForPublishing({ ...video, codec: "vp9" }, "REELS").errors).toHaveLength(1);
  });

  it("imagem: só em Story e só JPEG", () => {
    const jpeg = { ...video, mime_type: "image/jpeg", file_size: 1024, duration_ms: null, fps: null, codec: null };
    expect(validateAssetForPublishing(jpeg, "STORIES").errors).toEqual([]);
    expect(validateAssetForPublishing(jpeg, "REELS").errors).toHaveLength(1);
    expect(validateAssetForPublishing({ ...jpeg, mime_type: "image/png" }, "STORIES").errors).toHaveLength(1);
  });

  it("fora de 9:16 é aviso, não bloqueio", () => {
    const result = validateAssetForPublishing({ ...video, width: 1080, height: 1080 }, "REELS");
    expect(result.errors).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });
});

describe("accountCanPublish e collides", () => {
  it("exige conta conectada com a permissão", () => {
    expect(accountCanPublish({ status: "connected", permissions: ["instagram_business_content_publish"] })).toBe(true);
    expect(accountCanPublish({ status: "connected", permissions: ["instagram_business_basic"] })).toBe(false);
    expect(accountCanPublish({ status: "expired", permissions: ["instagram_business_content_publish"] })).toBe(false);
    expect(accountCanPublish({ status: "connected", permissions: null })).toBe(false);
  });

  it("colisão só dentro da janela de 15 minutos", () => {
    expect(collides(NOW, new Date(NOW.getTime() + 14 * 60_000))).toBe(true);
    expect(collides(NOW, new Date(NOW.getTime() + 15 * 60_000))).toBe(false);
  });
});

describe("friendlyPublishError", () => {
  it("junta a mensagem amigável com o detalhe da Meta", () => {
    expect(friendlyPublishError({ reason: "CONTAINER_ERROR", message: "codec" })).toContain("codec");
    expect(friendlyPublishError({ reason: "META_API_ERROR", message: "sem permissão" })).toBe("sem permissão");
    expect(friendlyPublishError(null)).toBe("Erro desconhecido.");
  });
});
