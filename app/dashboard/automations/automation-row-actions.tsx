"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

type Props = {
  automationId: string;
  status: "draft" | "active" | "paused" | "archived";
  hasPublishedVersion: boolean;
};

export function AutomationRowActions({ automationId, status, hasPublishedVersion }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: "active" | "paused" | "archived") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/automations/${automationId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Falha ao mudar status");
    router.refresh();
  }

  async function duplicate() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/automations/${automationId}/duplicate`, { method: "POST" });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Falha ao duplicar");
    router.push(`/dashboard/automations/${json.id}`);
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <button onClick={duplicate} disabled={busy} className="underline opacity-70">
        Duplicate
      </button>
      {status !== "active" && status !== "archived" && (
        <button
          onClick={() => setStatus("active")}
          disabled={busy}
          title={hasPublishedVersion ? undefined : "Publique uma versão antes de ativar"}
          className="underline text-green-700 disabled:opacity-40"
        >
          Activate
        </button>
      )}
      {status === "active" && (
        <button onClick={() => setStatus("paused")} disabled={busy} className="underline text-amber-700">
          Pause
        </button>
      )}
      {status !== "archived" && (
        <button
          onClick={() => {
            if (confirm("Arquivar essa automação? Isso é permanente no V1 (arquivada não pode ser reativada — duplique se precisar).")) {
              setStatus("archived");
            }
          }}
          disabled={busy}
          className="underline text-red-600"
        >
          Archive
        </button>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  );
}
