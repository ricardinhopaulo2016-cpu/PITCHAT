"use client";

import { useState } from "react";
import type { ResubscribeResult } from "@/lib/meta/resubscribe";

const STATUS_LABEL: Record<ResubscribeResult["status"], string> = {
  ok: "Atualizada",
  failed: "Falhou",
  skipped: "Ignorada",
};

/** Atualiza os eventos que as contas já conectadas recebem, sem reconectar. */
export function ResubscribeButton() {
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ResubscribeResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch("/api/social-accounts/resubscribe-webhooks", { method: "POST" });
      if (!res.ok) throw new Error("request_failed");
      const json = (await res.json()) as { results: ResubscribeResult[] };
      setResults(json.results);
    } catch {
      setError("Não foi possível atualizar agora. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 text-sm">
      <button onClick={handleClick} disabled={busy} className="text-text-secondary hover:text-text disabled:opacity-60">
        {busy ? "Atualizando…" : "Atualizar eventos das contas conectadas"}
      </button>
      <p className="mt-0.5 text-xs text-text-muted">Necessário para confirmar quando a pessoa visualiza uma mensagem.</p>

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {results && (
        <ul aria-live="polite" className="mt-2 flex flex-col gap-1 text-xs">
          {results.length === 0 && <li className="text-text-muted">Nenhuma conta encontrada.</li>}
          {results.map((r) => (
            <li key={r.accountId} className={r.status === "failed" ? "text-danger" : "text-text-secondary"}>
              {r.username ? `@${r.username}` : "Conta sem username"}: {STATUS_LABEL[r.status]}. {r.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
