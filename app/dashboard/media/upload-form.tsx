"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { formatBytes } from "@/lib/media/format";
import { friendlyUploadError } from "@/lib/media/error-messages";
import { Button } from "@/components/ui/button";

type UploadState =
  | { phase: "idle" }
  | { phase: "selected"; file: File }
  | { phase: "uploading"; file: File }
  | { phase: "processing"; file: File }
  | { phase: "ready" }
  | { phase: "duplicate"; existingAssetId: string }
  | { phase: "failed"; message: string; file: File };

const panel = "flex flex-col gap-3 rounded-[var(--radius-panel-sm)] border border-border-subtle bg-surface-1 p-4";

/** `onUploaded` recebe o id da mídia pronta, nova ou já existente na biblioteca. */
export function MediaUploadForm({ onUploaded }: { onUploaded?: (mediaAssetId: string) => void } = {}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>({ phase: "idle" });

  function reset() {
    setState({ phase: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  function handlePick() {
    inputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setState({ phase: "selected", file });
  }

  async function handleSend(file: File) {
    const supabase = getSupabaseBrowserClient();
    if (!supabase) {
      setState({ phase: "failed", message: "O sistema ainda não está configurado.", file });
      return;
    }

    try {
      setState({ phase: "uploading", file });
      const urlRes = await fetch("/api/media/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, fileSize: file.size }),
      });
      const urlBody = await urlRes.json().catch(() => ({}));
      if (!urlRes.ok) throw new Error(urlBody.error);
      const { mediaAssetId, storageKey, token } = urlBody;

      const { error: uploadError } = await supabase.storage
        .from("media")
        .uploadToSignedUrl(storageKey, token, file);
      if (uploadError) throw new Error("UPLOAD_FAILED");

      setState({ phase: "processing", file });
      const finalizeRes = await fetch("/api/media/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaAssetId }),
      });
      const finalizeBody = await finalizeRes.json().catch(() => ({}));
      if (!finalizeRes.ok) throw new Error(finalizeBody.error);

      if (finalizeBody.status === "EXACT_DUPLICATE") {
        setState({ phase: "duplicate", existingAssetId: finalizeBody.existingAssetId });
        onUploaded?.(finalizeBody.existingAssetId);
      } else {
        setState({ phase: "ready" });
        onUploaded?.(mediaAssetId);
      }
      router.refresh();
    } catch (err) {
      const code = err instanceof Error ? err.message : null;
      setState({ phase: "failed", message: friendlyUploadError(code), file });
    }
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        accept="video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
      />

      {state.phase === "idle" && (
        <Button type="button" onClick={handlePick}>
          Adicionar mídia
        </Button>
      )}

      {state.phase === "selected" && (
        <div className={panel}>
          <FilePreview file={state.file} />
          <div className="flex gap-2">
            <Button type="button" variant="primary" onClick={() => handleSend(state.file)}>
              Enviar mídia
            </Button>
            <Button type="button" onClick={reset}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {(state.phase === "uploading" || state.phase === "processing") && (
        <div className={panel}>
          <FilePreview file={state.file} />
          <p className="flex items-center gap-2 text-sm text-text-secondary">
            <Spinner />
            {state.phase === "uploading" ? "Enviando mídia…" : "Processando mídia…"}
          </p>
        </div>
      )}

      {state.phase === "ready" && (
        <div className={`${panel} flex-row items-center justify-between`}>
          <p className="text-sm text-success">Mídia enviada e pronta.</p>
          <Button type="button" variant="tertiary" onClick={reset}>
            Enviar outra
          </Button>
        </div>
      )}

      {state.phase === "duplicate" && (
        <div className={`${panel} flex-row items-center justify-between`}>
          <p className="text-sm text-warning">Esse arquivo já está na biblioteca.</p>
          <div className="flex items-center gap-3">
            <Link href={`/dashboard/media/${state.existingAssetId}`} className="text-sm text-text-secondary underline hover:text-text">
              Abrir mídia existente
            </Link>
            <Button type="button" variant="tertiary" onClick={reset}>
              Fechar
            </Button>
          </div>
        </div>
      )}

      {state.phase === "failed" && (
        <div className={panel}>
          <p className="text-sm text-danger">{state.message}</p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => handleSend(state.file)}>
              Tentar de novo
            </Button>
            <Button type="button" variant="tertiary" onClick={reset}>
              Escolher outro arquivo
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilePreview({ file }: { file: File }) {
  return (
    <div className="text-sm">
      <p className="break-all font-medium text-text">{file.name}</p>
      <p className="text-text-muted">
        {formatBytes(file.size)} · {file.type || "tipo desconhecido"}
      </p>
    </div>
  );
}

function Spinner() {
  return (
    <span
      className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent"
      aria-hidden="true"
    />
  );
}
