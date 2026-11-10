import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export type UploadResult = {
  mediaAssetId: string;
  /** O mesmo vídeo já estava na biblioteca: a mídia devolvida é a que já existia. */
  duplicate: boolean;
  /** Era duplicata de um vídeo cujo arquivo tinha sido apagado após publicar: voltou a ficar pronto. */
  restored: boolean;
};

/**
 * Envio no navegador: pede a URL assinada, manda os bytes direto ao Storage e
 * finaliza. Erro sai como Error com o código da rota (ex.: FILE_TOO_LARGE),
 * para `friendlyUploadError` traduzir.
 */
export async function uploadMediaFile(file: File, onPhase?: (phase: "uploading" | "processing") => void): Promise<UploadResult> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) throw new Error("SUPABASE_NOT_CONFIGURED");

  onPhase?.("uploading");
  const urlRes = await fetch("/api/media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, fileSize: file.size }),
  });
  const urlBody = await urlRes.json().catch(() => ({}));
  if (!urlRes.ok) throw new Error(urlBody.error);
  const { mediaAssetId, storageKey, token } = urlBody;

  const { error: uploadError } = await supabase.storage.from("media").uploadToSignedUrl(storageKey, token, file);
  if (uploadError) throw new Error("UPLOAD_FAILED");

  onPhase?.("processing");
  const finalizeRes = await fetch("/api/media/finalize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaAssetId }),
  });
  const finalizeBody = await finalizeRes.json().catch(() => ({}));
  if (!finalizeRes.ok) throw new Error(finalizeBody.error);

  if (finalizeBody.status === "EXACT_DUPLICATE") {
    return { mediaAssetId: finalizeBody.existingAssetId, duplicate: true, restored: !!finalizeBody.restored };
  }
  return { mediaAssetId, duplicate: false, restored: false };
}
