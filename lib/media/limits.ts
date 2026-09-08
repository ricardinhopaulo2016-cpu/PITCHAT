/**
 * MIME types aceitos na Media Library (Fase 2: vídeo + imagem, o que a
 * operação realmente usa em criativos de Reels/TikTok). Validado por magic
 * bytes reais (lib/media/mime.ts), nunca só pela extensão do arquivo ou pelo
 * Content-Type que o cliente informou.
 */
export const ALLOWED_MIME_TYPES = [
  "video/mp4",
  "video/quicktime", // .mov
  "video/webm",
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export function isAllowedMimeType(mime: string): mime is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(mime);
}

/** Configurável via env pra não exigir redeploy quando o limite precisar mudar. */
export function getMaxUploadSizeBytes(): number {
  const mb = Number(process.env.MEDIA_MAX_UPLOAD_SIZE_MB ?? "500");
  return mb * 1024 * 1024;
}
