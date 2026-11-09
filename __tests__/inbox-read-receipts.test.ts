import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fakes/fake-supabase";
import { classifyWebhookEventType, normalizeMetaWebhookPayload } from "@/lib/meta/events";
import { ingestInstagramMessageSeen } from "@/lib/automation/ingest";
import { composeTimeline } from "@/lib/inbox/repo";
import { resubscribeWorkspaceWebhooks } from "@/lib/meta/resubscribe";
import type { InstagramMessageSeen } from "@/lib/meta/events";

const ACCOUNT = "17841400000000000";
const READER = "1234567890";

describe("parser de leitura", () => {
  const expected = {
    type: "InstagramMessageSeen",
    externalAccountId: ACCOUNT,
    fromUserId: READER,
    externalMessageId: "mid-1",
    watermarkAt: null,
    timestamp: new Date(1893456000123).toISOString(),
  };
  const value = { sender: { id: READER }, recipient: { id: ACCOUNT }, timestamp: 1893456000123, read: { mid: "mid-1" } };

  it("entry.messaging[] com read.mid", () => {
    const events = normalizeMetaWebhookPayload({ entry: [{ id: ACCOUNT, time: 1893456000, messaging: [value] }] });
    expect(events).toEqual([expected]);
  });

  it("entry.changes[] com field messaging_seen", () => {
    const events = normalizeMetaWebhookPayload({ entry: [{ id: ACCOUNT, time: 1893456000, changes: [{ field: "messaging_seen", value }] }] });
    expect(events).toEqual([expected]);
  });

  it("field/value direto no entry", () => {
    const events = normalizeMetaWebhookPayload({ entry: [{ id: ACCOUNT, time: 1893456000, field: "messaging_seen", value }] });
    expect(events).toEqual([expected]);
  });

  it("read dentro de field messages também é leitura, nunca mensagem", () => {
    const events = normalizeMetaWebhookPayload({ entry: [{ id: ACCOUNT, time: 1893456000, changes: [{ field: "messages", value }] }] });
    expect(events).toEqual([expected]);
  });

  it("só watermark vira horário ISO", () => {
    const events = normalizeMetaWebhookPayload({
      entry: [{ id: ACCOUNT, time: 1893456000, messaging: [{ sender: { id: READER }, read: { watermark: 1893456000123 } }] }],
    });
    expect(events[0]).toMatchObject({ type: "InstagramMessageSeen", externalMessageId: null, watermarkAt: new Date(1893456000123).toISOString() });
  });

  it("sem sender é ignorado", () => {
    const events = normalizeMetaWebhookPayload({
      entry: [
        { id: ACCOUNT, messaging: [{ recipient: { id: ACCOUNT }, read: { mid: "mid-1" } }] },
        { id: ACCOUNT, changes: [{ field: "messaging_seen", value: { read: { mid: "mid-1" } } }] },
      ],
    });
    expect(events).toEqual([]);
  });

  it("sem mid e sem watermark é ignorado, não vira mensagem", () => {
    const events = normalizeMetaWebhookPayload({
      entry: [
        { id: ACCOUNT, messaging: [{ sender: { id: READER }, read: {} }] },
        { id: ACCOUNT, changes: [{ field: "messaging_seen", value: { sender: { id: READER }, read: { watermark: "abc" } } }] },
      ],
    });
    expect(events).toEqual([]);
  });

  it("field messaging_seen nunca vira mensagem, mesmo com objeto message", () => {
    const events = normalizeMetaWebhookPayload({
      entry: [{ id: ACCOUNT, changes: [{ field: "messaging_seen", value: { sender: { id: READER }, message: { mid: "x", text: "oi" } } }] }],
    });
    expect(events).toEqual([]);
  });

  it("horário inválido cai no horário do entry e não derruba o parser", () => {
    const events = normalizeMetaWebhookPayload({
      entry: [{ id: ACCOUNT, time: 1893456000, messaging: [{ sender: { id: READER }, timestamp: 99, read: { mid: "m" } }] }],
    });
    expect(events[0].timestamp).toBe(new Date(1893456000 * 1000).toISOString());
  });

  it("mensagem normal continua sendo mensagem", () => {
    const events = normalizeMetaWebhookPayload({
      entry: [{ id: ACCOUNT, messaging: [{ sender: { id: READER }, message: { mid: "m1", text: "oi" } }] }],
    });
    expect(events[0].type).toBe("InstagramMessageReceived");
  });

  it("classifica leitura nos formatos aceitos", () => {
    expect(classifyWebhookEventType({ entry: [{ changes: [{ field: "messaging_seen", value: {} }] }] })).toBe("messaging_seen");
    expect(classifyWebhookEventType({ entry: [{ messaging: [value] }] })).toBe("messaging_seen");
    expect(classifyWebhookEventType({ entry: [{ messaging: [{ sender: { id: READER }, message: { mid: "m" } }] }] })).toBe("messages");
    expect(classifyWebhookEventType({ entry: [{ messaging: [value, { sender: { id: READER }, message: { mid: "m" } }] }] })).toBe("mixed");
  });
});

const socialAccount = {
  id: "sa1",
  workspace_id: "ws1",
  profile_id: "profile1",
  external_account_id: "ig-account-1",
  access_token_encrypted: null,
};

const READ_AT = "2026-11-09T21:30:00.000Z";

function seen(overrides: Partial<InstagramMessageSeen> = {}): InstagramMessageSeen {
  return {
    type: "InstagramMessageSeen",
    externalAccountId: "ig-account-1",
    fromUserId: "user-1",
    externalMessageId: "out-2",
    watermarkAt: null,
    timestamp: READ_AT,
    ...overrides,
  };
}

function outbound(id: string, sentAt: string | null, overrides: Record<string, unknown> = {}) {
  return {
    id,
    workspace_id: "ws1",
    conversation_id: "conv1",
    external_message_id: id,
    direction: "outbound",
    origin: "automation",
    status: "sent",
    sent_at: sentAt,
    read_at: null,
    ...overrides,
  };
}

function seed() {
  const fake = createFakeSupabase();
  fake.__tables.contacts.push({ id: "contact1", workspace_id: "ws1", platform: "instagram", platform_user_id: "user-1" });
  fake.__tables.conversations.push({ id: "conv1", workspace_id: "ws1", social_account_id: "sa1", contact_id: "contact1", unread_inbound_count: 0 });
  fake.__tables.messages.push(
    outbound("out-1", "2026-11-09T10:00:00.000Z"),
    outbound("out-2", "2026-11-09T11:00:00.000Z"),
    outbound("out-3", "2026-11-09T12:00:00.000Z")
  );
  return fake;
}

const readAtOf = (fake: ReturnType<typeof seed>, id: string) => fake.__tables.messages.find((m) => m.id === id)?.read_at;

describe("ingest de leitura", () => {
  it("marca a mensagem indicada e as anteriores, não as posteriores", async () => {
    const fake = seed();
    const result = await ingestInstagramMessageSeen(fake as never, socialAccount, seen());

    expect(result).toEqual({ processed: true });
    expect(readAtOf(fake, "out-1")).toBe(READ_AT);
    expect(readAtOf(fake, "out-2")).toBe(READ_AT);
    expect(readAtOf(fake, "out-3")).toBeNull();
  });

  it("não altera messages.status (as métricas contam por ele)", async () => {
    const fake = seed();
    await ingestInstagramMessageSeen(fake as never, socialAccount, seen());
    expect(fake.__tables.messages.every((m) => m.status === "sent")).toBe(true);
  });

  it("idempotente: repetir o evento não troca o horário já gravado", async () => {
    const fake = seed();
    await ingestInstagramMessageSeen(fake as never, socialAccount, seen());
    await ingestInstagramMessageSeen(fake as never, socialAccount, seen({ timestamp: "2026-11-09T23:59:00.000Z" }));
    expect(readAtOf(fake, "out-2")).toBe(READ_AT);
  });

  it("mid que não casa não marca nada, mesmo com watermark", async () => {
    const fake = seed();
    const result = await ingestInstagramMessageSeen(
      fake as never,
      socialAccount,
      seen({ externalMessageId: "desconhecido", watermarkAt: "2026-11-09T23:00:00.000Z" })
    );
    expect(result).toEqual({ processed: false, reason: "MESSAGE_NOT_FOUND" });
    expect(fake.__tables.messages.every((m) => m.read_at === null)).toBe(true);
  });

  it("só watermark marca as enviadas até esse horário", async () => {
    const fake = seed();
    await ingestInstagramMessageSeen(fake as never, socialAccount, seen({ externalMessageId: null, watermarkAt: "2026-11-09T11:30:00.000Z" }));
    expect(readAtOf(fake, "out-1")).toBe(READ_AT);
    expect(readAtOf(fake, "out-2")).toBe(READ_AT);
    expect(readAtOf(fake, "out-3")).toBeNull();
  });

  it("watermark tem folga para o sent_at do nosso relógio, sem pegar DM bem posterior", async () => {
    const fake = createFakeSupabase();
    fake.__tables.contacts.push({ id: "contact1", workspace_id: "ws1", platform: "instagram", platform_user_id: "user-1" });
    fake.__tables.conversations.push({ id: "conv1", workspace_id: "ws1", social_account_id: "sa1", contact_id: "contact1" });
    fake.__tables.messages.push(outbound("lida", "2026-11-09T12:00:00.650Z"), outbound("depois", "2026-11-09T12:01:00.000Z"));

    await ingestInstagramMessageSeen(fake as never, socialAccount, seen({ externalMessageId: null, watermarkAt: "2026-11-09T12:00:00.100Z" }));

    expect(fake.__tables.messages.find((m) => m.id === "lida")?.read_at).toBe(READ_AT);
    expect(fake.__tables.messages.find((m) => m.id === "depois")?.read_at).toBeNull();
  });

  it("com mid, o corte é o sent_at da própria mensagem, sem folga", async () => {
    const fake = createFakeSupabase();
    fake.__tables.contacts.push({ id: "contact1", workspace_id: "ws1", platform: "instagram", platform_user_id: "user-1" });
    fake.__tables.conversations.push({ id: "conv1", workspace_id: "ws1", social_account_id: "sa1", contact_id: "contact1" });
    fake.__tables.messages.push(outbound("out-2", "2026-11-09T12:00:00.000Z"), outbound("logo-depois", "2026-11-09T12:00:01.000Z"));

    await ingestInstagramMessageSeen(fake as never, socialAccount, seen());

    expect(fake.__tables.messages.find((m) => m.id === "logo-depois")?.read_at).toBeNull();
  });

  it("não marca DM recebida nem envio que falhou", async () => {
    const fake = seed();
    fake.__tables.messages.push(
      { id: "in-1", workspace_id: "ws1", conversation_id: "conv1", external_message_id: "in-1", direction: "inbound", status: "delivered", sent_at: "2026-11-09T09:00:00.000Z", read_at: null },
      outbound("falhou", "2026-11-09T09:30:00.000Z", { status: "failed", external_message_id: null })
    );
    await ingestInstagramMessageSeen(fake as never, socialAccount, seen());
    expect(readAtOf(fake, "in-1")).toBeNull();
    expect(readAtOf(fake, "falhou")).toBeNull();
  });

  it("nunca cria contato nem conversa", async () => {
    const fake = seed();
    const result = await ingestInstagramMessageSeen(fake as never, socialAccount, seen({ fromUserId: "desconhecido" }));
    expect(result).toEqual({ processed: false, reason: "CONTACT_NOT_FOUND" });
    expect(fake.__tables.contacts).toHaveLength(1);
    expect(fake.__tables.conversations).toHaveLength(1);
  });

  it("conversa inexistente não cria nada", async () => {
    const fake = createFakeSupabase();
    fake.__tables.contacts.push({ id: "contact1", workspace_id: "ws1", platform: "instagram", platform_user_id: "user-1" });
    const result = await ingestInstagramMessageSeen(fake as never, socialAccount, seen());
    expect(result).toEqual({ processed: false, reason: "CONVERSATION_NOT_FOUND" });
    expect(fake.__tables.conversations).toHaveLength(0);
  });

  it("contato de outro workspace não é considerado", async () => {
    const fake = createFakeSupabase();
    fake.__tables.contacts.push({ id: "alheio", workspace_id: "ws2", platform: "instagram", platform_user_id: "user-1" });
    fake.__tables.conversations.push({ id: "conv-alheia", workspace_id: "ws2", social_account_id: "sa1", contact_id: "alheio" });
    fake.__tables.messages.push(outbound("out-2", "2026-11-09T10:00:00.000Z", { workspace_id: "ws2", conversation_id: "conv-alheia" }));

    const result = await ingestInstagramMessageSeen(fake as never, socialAccount, seen());

    expect(result.processed).toBe(false);
    expect(fake.__tables.messages[0].read_at).toBeNull();
  });

  it("nunca conta como não lida, nunca grava mensagem, nunca toca em run", async () => {
    const fake = seed();
    fake.__tables.automation_runs.push({ id: "run1", conversation_id: "conv1", status: "waiting", waiting_reason: "quick_reply" });

    await ingestInstagramMessageSeen(fake as never, socialAccount, seen());

    expect(fake.__rpcCalls).toHaveLength(0);
    expect(fake.__tables.messages).toHaveLength(3);
    expect(fake.__tables.conversations[0].unread_inbound_count).toBe(0);
    expect(fake.__tables.automation_runs[0].status).toBe("waiting");
  });

  it("leitura feita pela própria conta é ignorada", async () => {
    const fake = seed();
    const result = await ingestInstagramMessageSeen(fake as never, socialAccount, seen({ fromUserId: "ig-account-1" }));
    expect(result).toEqual({ processed: false, reason: "IGNORED_OWN_READ" });
  });

  it("sem a coluna read_at (antes da migration) falha em silêncio, sem lançar", async () => {
    const fake = seed();
    fake.__setMissingColumns("read_at");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ingestInstagramMessageSeen(fake as never, socialAccount, seen())).resolves.toEqual({ processed: false, reason: "FAILED" });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("erro inesperado do banco também não derruba o worker", async () => {
    const admin = {
      from() {
        throw new Error("banco fora");
      },
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(ingestInstagramMessageSeen(admin as never, socialAccount, seen())).resolves.toEqual({ processed: false, reason: "READ_RECEIPT_FAILED" });
    spy.mockRestore();
  });
});

describe("indicador na timeline", () => {
  const base = { created_at: "2026-11-09T10:00:00.000Z", sent_at: "2026-11-09T10:00:00.000Z", received_at: null, text: "x" };
  const compose = (messages: Parameters<typeof composeTimeline>[0]["messages"]) => composeTimeline({ comments: [], steps: [], messages });

  it("enviada sem confirmação é Enviada, com read_at é Visualizada", () => {
    const [sent, seenEntry] = compose([
      { ...base, id: "a", direction: "outbound", origin: "automation", status: "sent" },
      { ...base, id: "b", direction: "outbound", origin: "manual", status: "sent", read_at: READ_AT },
    ]);
    expect(sent.delivery).toEqual({ state: "sent" });
    expect(seenEntry.delivery).toEqual({ state: "seen", at: READ_AT });
  });

  it("falha continua sendo falha, mesmo com read_at", () => {
    const [entry] = compose([{ ...base, id: "a", direction: "outbound", origin: "manual", status: "failed", read_at: READ_AT }]);
    expect(entry.delivery).toEqual({ state: "failed" });
  });

  it("DM recebida e comentário não têm indicador", () => {
    const timeline = composeTimeline({
      comments: [{ id: "c", text: "oi", created_at: "2026-11-09T09:00:00.000Z", external_media_id: null }],
      steps: [],
      messages: [{ ...base, id: "a", direction: "inbound", origin: null, status: "delivered" }],
    });
    expect(timeline.every((e) => e.delivery === undefined)).toBe(true);
  });

  it("mensagem ainda na fila não mostra Enviada", () => {
    const [entry] = compose([{ ...base, id: "a", direction: "outbound", origin: "automation", status: "queued", sent_at: null }]);
    expect(entry.delivery).toBeUndefined();
  });
});

describe("reassinar webhooks das contas do workspace", () => {
  const SECRET_TOKEN = "token-super-secreto";

  function seedAccounts() {
    const fake = createFakeSupabase();
    fake.__tables.social_accounts = [
      { id: "ok", workspace_id: "ws1", platform: "instagram", status: "connected", username: "conta_ok", external_account_id: "ig-ok", access_token_encrypted: "cifrado" },
      { id: "recusada", workspace_id: "ws1", platform: "instagram", status: "connected", username: "conta_recusada", external_account_id: "ig-recusada", access_token_encrypted: "cifrado" },
      { id: "expirada", workspace_id: "ws1", platform: "instagram", status: "expired", username: "conta_expirada", external_account_id: "ig-expirada", access_token_encrypted: "cifrado" },
      { id: "revogada", workspace_id: "ws1", platform: "instagram", status: "revoked", username: "revogada", external_account_id: "ig-rev", access_token_encrypted: null },
      { id: "alheia", workspace_id: "ws2", platform: "instagram", status: "connected", username: "alheia", external_account_id: "ig-alheia", access_token_encrypted: "cifrado" },
    ];
    return fake;
  }

  it("devolve resultado por conta, só do workspace, sem token", async () => {
    const fake = seedAccounts();
    const subscribe = vi.fn(async (_token: string, igUserId: string) => igUserId === "ig-ok");

    const results = await resubscribeWorkspaceWebhooks(fake as never, "ws1", { subscribe, decrypt: () => SECRET_TOKEN });

    expect(results.map((r) => [r.accountId, r.status])).toEqual([
      ["ok", "ok"],
      ["recusada", "failed"],
      ["expirada", "skipped"],
    ]);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(results)).not.toContain(SECRET_TOKEN);
    expect(JSON.stringify(results)).not.toContain("cifrado");
  });

  it("erro de uma conta não impede as outras e não vaza a mensagem bruta", async () => {
    const fake = seedAccounts();
    const subscribe = vi.fn(async (token: string, igUserId: string) => {
      if (igUserId === "ig-ok") throw new Error(`fetch failed access_token=${token}`);
      return true;
    });

    const results = await resubscribeWorkspaceWebhooks(fake as never, "ws1", { subscribe, decrypt: () => SECRET_TOKEN });

    expect(results.find((r) => r.accountId === "ok")?.status).toBe("failed");
    expect(results.find((r) => r.accountId === "recusada")?.status).toBe("ok");
    expect(JSON.stringify(results)).not.toContain(SECRET_TOKEN);
  });
});
