"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { formatBytes } from "@/lib/media/format";
import { friendlyUploadError } from "@/lib/media/error-messages";

type UploadState =
  | { phase: "idle" }
  | { phase: "selected"; file: File }
  | { phase: "uploading"; file: File }
  | { phase: "processing"; file: File }
  | { phase: "ready" }
  | { phase: "duplicate"; existingAssetId: string }
  | { phase: "failed"; message: string; file: File };

export function MediaUploadForm() {
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
      } else {
        setState({ phase: "ready" });
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
        <button
          onClick={handlePick}
          className="rounded border px-4 py-2 text-sm font-medium hover:bg-gray-50"
        >
          Adicionar mídia
        </button>
      )}

      {state.phase === "selected" && (
        <div className="flex flex-col gap-2 rounded border p-4">
          <FilePreview file={state.file} />
          <div className="flex gap-2">
            <button
              onClick={() => handleSend(state.file)}
              className="rounded bg-black px-4 py-2 text-sm font-medium text-white"
            >
              Enviar mídia
            </button>
            <button onClick={reset} className="rounded border px-4 py-2 text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {(state.phase === "uploading" || state.phase === "processing") && (
        <div className="flex flex-col gap-2 rounded border p-4">
          <FilePreview file={state.file} />
          <p className="flex items-center gap-2 text-sm opacity-70">
            <Spinner />
            {state.phase === "uploading" ? "Enviando mídia…" : "Processando mídia…"}
          </p>
        </div>
      )}

      {state.phase === "ready" && (
        <div className="flex items-center justify-between rounded border border-green-200 bg-green-50 p-4">
          <p className="text-sm text-green-800">Mídia enviada e pronta.</p>
          <button onClick={reset} className="text-sm underline">
            Enviar outra
          </button>
        </div>
      )}

      {state.phase === "duplicate" && (
        <div className="flex items-center justify-between rounded border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm text-amber-800">Esse vídeo já está na sua biblioteca.</p>
          <div className="flex gap-3">
            <Link
              href={`/dashboard/media/${state.existingAssetId}`}
              className="text-sm underline"
            >
              Abrir mídia existente
            </Link>
            <button onClick={reset} className="text-sm underline opacity-70">
              Fechar
            </button>
          </div>
        </div>
      )}

      {state.phase === "failed" && (
        <div className="flex flex-col gap-2 rounded border border-red-200 bg-red-50 p-4">
          <p className="text-sm text-red-800">{state.message}</p>
          <div className="flex gap-2">
            <button
              onClick={() => handleSend(state.file)}
              className="rounded border px-3 py-1.5 text-sm"
            >
              Tentar de novo
            </button>
            <button onClick={reset} className="text-sm underline opacity-70">
              Escolher outro arquivo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilePreview({ file }: { file: File }) {
  return (
    <div className="text-sm">
      <p className="font-medium break-all">{file.name}</p>
      <p className="opacity-60">
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
