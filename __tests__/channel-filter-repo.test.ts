import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "./fakes/fake-supabase";
import { listConversations } from "@/lib/inbox/repo";
import { listContacts } from "@/lib/contacts/repo";

/**
 * D1 — o filtro por canal precisa acontecer NA QUERY, antes do teto de
 * linhas. Os fixtures abaixo colocam o canal filtrado deliberadamente FORA
 * do "top N mais recente global": se alguém regredir pra "busca os N mais
 * recentes de todos os canais e filtra depois em JS", o resultado esperado
 * (não vazio) vira vazio — é isso que os testes travam.
 */

describe("listConversations — filtro por social_account_id acontece antes do LIMIT", () => {
  function seed() {
    const supabase = createFakeSupabase();
    const contact = (id: string) => ({ username: id, avatar_url: null, platform: "instagram" });
    const account = (username: string) => ({ username });

    // 60 conversas do canal B, todas mais recentes que as do canal A — se o
    // filtro rodasse depois do LIMIT (50), as 2 de A já teriam sido cortadas.
    for (let i = 0; i < 60; i++) {
      supabase.__tables.conversations.push({
        id: `b-${i}`,
        workspace_id: "ws-1",
        contact_id: `contact-b-${i}`,
        social_account_id: "sa-B",
        automation_enabled: true,
        last_message_at: `2026-09-27T10:${String(i).padStart(2, "0")}:00.000Z`,
        last_read_at: null,
        contact: contact(`b${i}`),
        social_account: account("dodo_passagens"),
      });
    }
    supabase.__tables.conversations.push(
      {
        id: "a-1",
        workspace_id: "ws-1",
        contact_id: "contact-a-1",
        social_account_id: "sa-A",
        automation_enabled: true,
        last_message_at: "2026-09-20T00:00:00.000Z", // bem mais antiga que qualquer uma de B
        last_read_at: null,
        contact: contact("a1"),
        social_account: account("papagaio_milhas"),
      },
      {
        id: "a-2",
        workspace_id: "ws-1",
        contact_id: "contact-a-2",
        social_account_id: "sa-A",
        automation_enabled: true,
        last_message_at: "2026-09-19T00:00:00.000Z",
        last_read_at: null,
        contact: contact("a2"),
        social_account: account("papagaio_milhas"),
      }
    );
    return supabase;
  }

  it("sem channel: comportamento de sempre (top 50 globais, canal A fica de fora)", async () => {
    const rows = await listConversations(seed() as never, "ws-1");
    expect(rows).toHaveLength(50);
    expect(rows.some((r) => r.id.startsWith("a-"))).toBe(false);
  });

  it("com channel=A: as 2 conversas de A aparecem, mesmo sendo as mais antigas globalmente", async () => {
    const rows = await listConversations(seed() as never, "ws-1", { socialAccountId: "sa-A" });
    expect(rows.map((r) => r.id).sort()).toEqual(["a-1", "a-2"]);
    expect(rows.every((r) => r.socialAccountUsername === "papagaio_milhas")).toBe(true);
  });

  it("com channel sem nenhuma conversa: retorna vazio, nunca cai pra 'todos'", async () => {
    const rows = await listConversations(seed() as never, "ws-1", { socialAccountId: "sa-inexistente" });
    expect(rows).toEqual([]);
  });
});

describe("listContacts — filtro por social_account_id (via conversations) acontece antes do LIMIT", () => {
  function seed() {
    const supabase = createFakeSupabase();
    // 100 contacts recentes SEM nenhuma conversation no canal A (preenchem o
    // LIST_LIMIT=100 sozinhos) + 1 contact só alcançável via canal A, com
    // last_seen_at mais antigo que todos os outros.
    for (let i = 0; i < 100; i++) {
      supabase.__tables.contacts.push({
        id: `other-${i}`,
        workspace_id: "ws-1",
        username: `other${i}`,
        avatar_url: null,
        platform: "instagram",
        first_seen_at: "2026-09-01T00:00:00.000Z",
        last_seen_at: `2026-09-27T10:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }
    supabase.__tables.contacts.push({
      id: "contact-a",
      workspace_id: "ws-1",
      username: "paulo.cadoxd",
      avatar_url: null,
      platform: "instagram",
      first_seen_at: "2026-09-01T00:00:00.000Z",
      last_seen_at: "2026-09-10T00:00:00.000Z", // mais antigo que os 100 acima
    });
    supabase.__tables.conversations.push({
      id: "conv-a",
      workspace_id: "ws-1",
      contact_id: "contact-a",
      social_account_id: "sa-A",
      updated_at: "2026-09-10T00:00:00.000Z",
      social_account: { username: "papagaio_milhas" },
    });
    return supabase;
  }

  it("com channel=A: o contact só alcançável via A aparece, mesmo sendo o mais antigo globalmente", async () => {
    const rows = await listContacts(seed() as never, "ws-1", { socialAccountId: "sa-A" });
    expect(rows.map((r) => r.id)).toEqual(["contact-a"]);
  });

  it("channel sem nenhum contact: retorna vazio sem round-trip desnecessário (nunca amplia pra 'todos')", async () => {
    const rows = await listContacts(seed() as never, "ws-1", { socialAccountId: "sa-vazio" });
    expect(rows).toEqual([]);
  });
});

describe("A != B (D0) — canal nunca faz merge/dedupe de contacts por username", () => {
  it("mesmo username, contact_id e platform_user_id diferentes: linhas distintas, cada uma no seu canal", async () => {
    const supabase = createFakeSupabase();
    supabase.__tables.contacts.push(
      {
        id: "contact-ig01",
        workspace_id: "ws-1",
        username: "paulo.cadoxd",
        avatar_url: null,
        platform: "instagram",
        platform_user_id: "1120289020330867",
        first_seen_at: "2026-09-24T00:00:00.000Z",
        last_seen_at: "2026-09-27T04:17:00.000Z",
      },
      {
        id: "contact-ig02",
        workspace_id: "ws-1",
        username: "paulo.cadoxd",
        avatar_url: null,
        platform: "instagram",
        platform_user_id: "1813191480038393",
        first_seen_at: "2026-09-27T04:23:00.000Z",
        last_seen_at: "2026-09-27T04:23:00.000Z",
      }
    );
    supabase.__tables.conversations.push(
      { id: "conv-ig01", workspace_id: "ws-1", contact_id: "contact-ig01", social_account_id: "sa-ig01", updated_at: "x", social_account: { username: "papagaio_milhas" } },
      { id: "conv-ig02", workspace_id: "ws-1", contact_id: "contact-ig02", social_account_id: "sa-ig02", updated_at: "x", social_account: { username: "dodo_passagens" } }
    );

    const all = await listContacts(supabase as never, "ws-1");
    expect(all.map((c) => c.id).sort()).toEqual(["contact-ig01", "contact-ig02"]);

    const viaIg01 = await listContacts(supabase as never, "ws-1", { socialAccountId: "sa-ig01" });
    const viaIg02 = await listContacts(supabase as never, "ws-1", { socialAccountId: "sa-ig02" });
    expect(viaIg01.map((c) => c.id)).toEqual(["contact-ig01"]);
    expect(viaIg02.map((c) => c.id)).toEqual(["contact-ig02"]);
  });
});
