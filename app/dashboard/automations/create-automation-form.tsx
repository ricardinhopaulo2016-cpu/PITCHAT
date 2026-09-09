"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CreateAutomationForm({ profiles }: { profiles: { id: string; name: string }[] }) {
  const router = useRouter();
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"create" | "seed" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy("create");
    setError(null);
    const res = await fetch("/api/automations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId, name }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setError(json.error ?? "Falha ao criar automação");
    router.push(`/dashboard/automations/${json.id}`);
  }

  async function handleSeedExample() {
    setBusy("seed");
    setError(null);
    const res = await fetch("/api/automations/seed-example", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId }),
    });
    const json = await res.json();
    setBusy(null);
    if (!res.ok) return setError(json.error ?? "Falha ao criar flow de exemplo");
    router.push(`/dashboard/automations/${json.id}`);
  }

  return (
    <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-3 rounded border p-4">
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-60">Profile</label>
        <select
          value={profileId}
          onChange={(e) => setProfileId(e.target.value)}
          className="rounded border px-2 py-1.5 text-sm"
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs opacity-60">Nome da automação</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ex: Comentário → DM"
          className="rounded border px-2 py-1.5 text-sm"
        />
      </div>
      <button
        type="submit"
        disabled={busy !== null || !name.trim()}
        className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
      >
        {busy === "create" ? "Criando…" : "Create"}
      </button>
      <button
        type="button"
        onClick={handleSeedExample}
        disabled={busy !== null}
        className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
        title="Cria o flow de referência do MVP: comentário → keyword → public reply → private reply → quick reply → link → delay → follow-up"
      >
        {busy === "seed" ? "Criando…" : "Criar exemplo (Instagram Comment → DM Test)"}
      </button>
      {error && <p className="w-full text-sm text-red-600">{error}</p>}
    </form>
  );
}
