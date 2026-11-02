"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export function CreateAutomationForm({
  profiles,
  accounts,
}: {
  profiles: { id: string; name: string }[];
  accounts: { id: string; profile_id: string; username: string | null }[];
}) {
  const router = useRouter();
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [socialAccountId, setSocialAccountId] = useState("");
  const [name, setName] = useState("");
  const profileAccounts = accounts.filter((a) => a.profile_id === profileId);
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
      body: JSON.stringify({ profileId, name, socialAccountId: socialAccountId || undefined }),
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
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-muted">Perfil</label>
        <Select
          value={profileId}
          onChange={(e) => {
            setProfileId(e.target.value);
            setSocialAccountId(""); // a conta escolhida pertencia ao profile anterior
          }}
         
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-muted">Conta</label>
        <Select value={socialAccountId} onChange={(e) => setSocialAccountId(e.target.value)}>
          <option value="">Todas as contas do perfil</option>
          {profileAccounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.username ? `@${a.username}` : "conta sem username"}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-text-muted">Nome da automação</label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: EU QUERO do perfil" />
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
