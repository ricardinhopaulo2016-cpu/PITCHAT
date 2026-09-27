import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "./fakes/fake-supabase";
import { groupChannelAccountsByProfile, listWorkspaceChannelAccounts, normalizeChannelParam, resolveChannel } from "@/lib/channel/repo";

/**
 * D1 — Channel Filter. `normalizeChannelParam`/`resolveChannel` são a base
 * de "a URL é a única fonte de verdade": um channel inválido nunca amplia
 * silenciosamente o escopo pra "todos os canais".
 */

describe("normalizeChannelParam", () => {
  it("ausente ou 'all' vira null (todos os canais)", () => {
    expect(normalizeChannelParam(undefined)).toBeNull();
    expect(normalizeChannelParam(null)).toBeNull();
    expect(normalizeChannelParam("all")).toBeNull();
  });
  it("qualquer outra string segue como candidato a UUID (validação real é resolveChannel)", () => {
    expect(normalizeChannelParam("sa-1")).toBe("sa-1");
  });
  it("array (query duplicada) nunca é aceito como channel único", () => {
    expect(normalizeChannelParam(["a", "b"])).toBeNull();
  });
});

function seed() {
  const supabase = createFakeSupabase();
  const base = { workspace_id: "ws-1", platform: "instagram", status_detail: null, token_expires_at: null, created_at: "2026-09-01T00:00:00Z" };
  supabase.__tables.social_accounts = [
    { id: "ig01", profile_id: "p1", username: "papagaio_milhas", status: "connected", profile: { name: "Papagaio Milhas" }, ...base },
    { id: "ig02", profile_id: "p1", username: "dodo_passagens", status: "connected", profile: { name: "Papagaio Milhas" }, ...base, created_at: "2026-09-27T00:00:00Z" },
    { id: "old", profile_id: "p1", username: "antiga", status: "revoked", profile: { name: "Papagaio Milhas" }, ...base },
    { id: "outro-ws", profile_id: "p2", username: "de-outro-ws", status: "connected", profile: { name: "Outro" }, ...base, workspace_id: "ws-2" },
  ];
  return supabase;
}

describe("resolveChannel — nunca amplia silenciosamente o escopo", () => {
  it("channel válido do workspace resolve com username e profile", async () => {
    const channel = await resolveChannel(seed() as never, "ws-1", "ig01");
    expect(channel).toEqual({ id: "ig01", username: "papagaio_milhas", status: "connected", profileId: "p1", profileName: "Papagaio Milhas" });
  });

  it("channel inexistente resolve null", async () => {
    expect(await resolveChannel(seed() as never, "ws-1", "nao-existe")).toBeNull();
  });

  it("channel revoked resolve null (não é seleção válida, mesmo existindo a linha)", async () => {
    expect(await resolveChannel(seed() as never, "ws-1", "old")).toBeNull();
  });

  it("channel de OUTRO workspace resolve null — nunca confiar no id vindo do client sem validar workspace", async () => {
    expect(await resolveChannel(seed() as never, "ws-1", "outro-ws")).toBeNull();
  });
});

describe("listWorkspaceChannelAccounts / groupChannelAccountsByProfile", () => {
  it("lista as 2 contas do mesmo profile (nunca colapsa numa só) e agrupa preservando ordem", async () => {
    const accounts = await listWorkspaceChannelAccounts(seed() as never, "ws-1");
    expect(accounts.map((a) => a.username)).toEqual(["papagaio_milhas", "dodo_passagens"]);

    const groups = groupChannelAccountsByProfile(accounts);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ profileId: "p1", profileName: "Papagaio Milhas" });
    expect(groups[0].accounts.map((a) => a.username)).toEqual(["papagaio_milhas", "dodo_passagens"]);
  });

  it("nunca traz conta de outro workspace nem revoked", async () => {
    const accounts = await listWorkspaceChannelAccounts(seed() as never, "ws-1");
    expect(accounts.map((a) => a.id)).not.toContain("outro-ws");
    expect(accounts.map((a) => a.id)).not.toContain("old");
  });
});
