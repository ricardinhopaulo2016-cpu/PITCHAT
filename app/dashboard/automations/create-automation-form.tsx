"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

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
    <form
      onSubmit={handleCreate}
      className="flex flex-wrap items-end gap-3 rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-4"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-muted">Profile</label>
        <Select value={profileId} onChange={(e) => setProfileId(e.target.value)} className="w-44">
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-muted">Nome da automação</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Comentário → DM" className="w-56" />
      </div>
      <Button type="submit" variant="primary" disabled={busy !== null || !name.trim()}>
        {busy === "create" ? "Criando…" : "Nova automação"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={handleSeedExample}
        disabled={busy !== null}
        title="Cria o flow de referência do MVP: comentário → keyword → public reply → private reply → quick reply → link → delay → follow-up"
      >
        {busy === "seed" ? "Criando…" : "Criar exemplo"}
      </Button>
      {error && <p className="w-full text-sm text-danger">{error}</p>}
    </form>
  );
}
