import { fileTypeFromBuffer } from "file-type";
import { isAllowedMimeType, type AllowedMimeType } from "./limits";

export type MimeValidationResult =
  | { ok: true; mimeType: AllowedMimeType }
  | { ok: false; reason: "UNDETECTABLE" | "NOT_ALLOWED"; detectedMimeType?: string };

/**
 * Valida o MIME real do arquivo pelos magic bytes (assinatura binária), nunca
 * pelo Content-Type que o navegador mandou nem pela extensão do filename —
 * ambos são só metadado que o cliente controla e pode mentir.
 */
export async function detectAndValidateMime(buffer: Buffer): Promise<MimeValidationResult> {
  const detected = await fileTypeFromBuffer(buffer);

  if (!detected) {
    return { ok: false, reason: "UNDETECTABLE" };
  }

  if (!isAllowedMimeType(detected.mime)) {
    return { ok: false, reason: "NOT_ALLOWED", detectedMimeType: detected.mime };
  }

  return { ok: true, mimeType: detected.mime };
}
