/**
 * Regras da Meta para Reels e Stories, conferidas antes de agendar para o erro
 * aparecer na hora, não no horário do post. Fonte: referência de IG User Media
 * (lida em 02/11/2026). Moov atom, closed GOP e chroma não dá para checar com os
 * metadados guardados; nesses casos o erro volta da própria Meta.
 */

export type PublishMediaType = "REELS" | "STORIES";

export type PublishableAsset = {
  mime_type: string | null;
  file_size: number | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  codec: string | null;
};

export const CAPTION_MAX_LENGTH = 2200;

const MB = 1024 * 1024;
const VIDEO_MIMES = new Set(["video/mp4", "video/quicktime"]);
const VIDEO_CODECS = new Set(["h264", "hevc"]);

const LIMITS = {
  REELS: { maxBytes: 300 * MB, minMs: 3_000, maxMs: 15 * 60_000, label: "Reels" },
  STORIES: { maxBytes: 100 * MB, minMs: 3_000, maxMs: 60_000, label: "Stories" },
} as const;

export type AssetValidation = { errors: string[]; warnings: string[] };

export function mediaKindOf(mimeType: string | null): "video" | "image" | null {
  if (mimeType?.startsWith("video/")) return "video";
  if (mimeType?.startsWith("image/")) return "image";
  return null;
}

export function validateAssetForPublishing(asset: PublishableAsset, mediaType: PublishMediaType): AssetValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const limits = LIMITS[mediaType];
  const kind = mediaKindOf(asset.mime_type);

  if (kind === "image") {
    if (mediaType === "REELS") errors.push("Reels só aceitam vídeo.");
    if (asset.mime_type !== "image/jpeg") errors.push("Imagem de Stories precisa ser JPEG.");
    if ((asset.file_size ?? 0) > 8 * MB) errors.push("Imagem de Stories pode ter até 8 MB.");
  } else if (kind === "video") {
    if (!VIDEO_MIMES.has(asset.mime_type ?? "")) errors.push("O vídeo precisa ser MP4 ou MOV.");
    if ((asset.file_size ?? 0) > limits.maxBytes) errors.push(`Vídeo de ${limits.label} pode ter até ${limits.maxBytes / MB} MB.`);
    if (asset.duration_ms != null) {
      if (asset.duration_ms < limits.minMs) errors.push(`Vídeo de ${limits.label} precisa ter pelo menos 3 segundos.`);
      if (asset.duration_ms > limits.maxMs) {
        errors.push(mediaType === "REELS" ? "Reels podem ter até 15 minutos." : "Vídeo de Stories pode ter até 60 segundos.");
      }
    }
    if (asset.codec && !VIDEO_CODECS.has(asset.codec.toLowerCase())) errors.push("O vídeo precisa estar em H.264 ou HEVC.");
    if (asset.fps != null && (asset.fps < 23 || asset.fps > 60)) errors.push("O vídeo precisa ter entre 23 e 60 FPS.");
    if (asset.width != null && asset.width > 1920) errors.push("A largura máxima é 1920 px.");
  } else {
    errors.push("Formato de arquivo não reconhecido.");
  }

  if (asset.width && asset.height) {
    const ratio = asset.width / asset.height;
    if (Math.abs(ratio - 9 / 16) > 0.02) warnings.push("O arquivo não está em 9:16 e pode aparecer com corte ou barras.");
  }

  return { errors, warnings };
}

/** A conta pode publicar? O token de conexões antigas pode não ter a permissão. */
export function accountCanPublish(account: { status: string; permissions: string[] | null }): boolean {
  return account.status === "connected" && (account.permissions ?? []).includes("instagram_business_content_publish");
}

/** Dois Reels muito próximos na mesma conta competem entre si. */
export const COLLISION_WINDOW_MS = 15 * 60_000;

export function collides(a: Date, b: Date): boolean {
  return Math.abs(a.getTime() - b.getTime()) < COLLISION_WINDOW_MS;
}
