"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

type Phase = "idle" | "requesting" | "uploading" | "finalizing" | "done" | "error";

export function MediaUploadForm() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setPhase("error");
      setMessage("Supabase não configurado no browser.");
      return;
    }

    try {
      // 1. Pede a signed upload URL (o servidor já cria a linha media_assets
      // com status='pending' e valida tamanho declarado).
      setPhase("requesting");
      setMessage(null);
      const urlRes = await fetch("/api/media/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, fileSize: file.size }),
      });
      if (!urlRes.ok) {
        const body = await urlRes.json().catch(() => ({}));
        throw new Error(body.error ?? `upload-url falhou (${urlRes.status})`);
      }
      const { mediaAssetId, storageKey, token } = await urlRes.json();

      // 2. Upload direto pro Storage, sem passar pelo nosso servidor.
      setPhase("uploading");
      const { error: uploadError } = await supabase.storage
        .from("media")
        .uploadToSignedUrl(storageKey, token, file);
      if (uploadError) throw uploadError;

      // 3. Finalize: servidor baixa de volta, valida MIME real, tira SHA-256
      // e ffprobe, decide duplicata.
      setPhase("finalizing");
      const finalizeRes = await fetch("/api/media/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaAssetId }),
      });
      const finalizeBody = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) {
        throw new Error(finalizeBody.error ?? `finalize falhou (${finalizeRes.status})`);
      }

      setPhase("done");
      setMessage(
        finalizeBody.status === "EXACT_DUPLICATE"
          ? "Já existe esse arquivo na biblioteca (duplicata exata) — não foi duplicado."
          : "Upload processado."
      );
      router.refresh();
    } catch (err) {
      setPhase("error");
      setMessage(err instanceof Error ? err.message : "Falha desconhecida no upload.");
    } finally {
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  const busy = phase === "requesting" || phase === "uploading" || phase === "finalizing";

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={inputRef}
        type="file"
        accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
        disabled={busy}
        onChange={handleFileChange}
      />
      {phase !== "idle" && (
        <p className="text-sm opacity-70">
          {phase === "requesting" && "Preparando upload…"}
          {phase === "uploading" && "Enviando pro Storage…"}
          {phase === "finalizing" && "Validando (MIME, SHA-256, ffprobe)…"}
          {phase === "done" && message}
          {phase === "error" && `Erro: ${message}`}
        </p>
      )}
    </div>
  );
}
