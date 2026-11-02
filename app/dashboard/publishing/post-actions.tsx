"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

/** Cancelar vale para o que ainda não começou; tentar de novo vale para o que falhou. */
export function PostActions({ postId, status }: { postId: string; status: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: "cancel" | "retry") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/scheduled-posts/${postId}/${action}`, { method: "POST" });
    setBusy(false);
    if (!res.ok) {
      setError(action === "cancel" ? "O post já começou a sair." : "Não foi possível tentar de novo.");
    }
    router.refresh();
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      {status === "scheduled" && (
        <Button type="button" variant="tertiary" disabled={busy} onClick={() => run("cancel")}>
          Cancelar
        </Button>
      )}
      {status === "failed" && (
        <Button type="button" disabled={busy} onClick={() => run("retry")}>
          Tentar de novo
        </Button>
      )}
    </div>
  );
}
