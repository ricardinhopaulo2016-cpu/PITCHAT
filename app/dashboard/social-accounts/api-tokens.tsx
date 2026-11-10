"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export type ApiTokenRow = {
  id: string;
  name: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

function formatDate(iso: string | null): string {
  if (!iso) return "nunca";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
}

/** Tokens da API: subir e agendar vídeos sem o navegador. O token aparece uma vez só. */
export function ApiTokens({ tokens }: { tokens: ApiTokenRow[] }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setBusy(true);
    setError(null);
    setCreated(null);
    setCopied(false);
    try {
      const res = await fetch("/api/api-tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim() || "Claude" }),
      });
      const json = (await res.json().catch(() => null)) as { token?: string; problems?: string[] } | null;
      if (!res.ok || !json?.token) throw new Error(json?.problems?.[0] ?? "Não foi possível gerar o token.");
      setCreated(json.token);
      setName("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Não foi possível gerar o token.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/api-tokens/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setError("Não foi possível revogar agora. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const active = tokens.filter((t) => !t.revoked_at);

  return (
    <section aria-labelledby="api-tokens" className="mt-8 rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 px-6 py-5">
      <h2 id="api-tokens" className="text-lg font-semibold text-text">
        Acesso pela API
      </h2>
      <p className="mt-0.5 text-xs text-text-muted">Para o Claude subir e agendar vídeos sem abrir o navegador. Quem tem o token agenda posts em todas as contas.</p>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome (ex.: Claude no PC do Paulo)"
          maxLength={60}
          aria-label="Nome do token"
          className="h-9 min-w-0 flex-1 rounded-[var(--radius-button)] border border-border bg-surface-2 px-3 text-sm text-text placeholder:text-text-muted"
        />
        <button
          onClick={create}
          disabled={busy}
          className="inline-flex h-9 items-center justify-center rounded-[var(--radius-button)] bg-signal px-3 text-sm font-medium text-signal-on hover:bg-signal-hover disabled:opacity-60"
        >
          Gerar token
        </button>
      </div>

      {created && (
        <div role="status" className="mt-3 rounded-[var(--radius-panel-sm)] border border-success bg-success-soft px-3.5 py-2.5 text-sm text-text">
          <p className="font-medium">Copie agora: este token não aparece de novo.</p>
          <code className="mt-1 block break-all font-mono text-xs">{created}</code>
          <button onClick={copy} className="mt-2 text-xs text-text-secondary hover:text-text">
            {copied ? "Copiado" : "Copiar"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      {active.length > 0 && (
        <ul className="mt-4 divide-y divide-border-subtle border-t border-border-subtle text-sm">
          {active.map((t) => (
            <li key={t.id} className="flex flex-wrap items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-text">{t.name}</p>
                <p className="text-xs text-text-muted">
                  <span className="font-mono">{t.token_prefix}…</span> · criado {formatDate(t.created_at)} · último uso {formatDate(t.last_used_at)}
                </p>
              </div>
              <button onClick={() => revoke(t.id)} disabled={busy} className="text-sm text-text-secondary hover:text-danger disabled:opacity-60">
                Revogar
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
