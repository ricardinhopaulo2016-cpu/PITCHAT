import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "./fakes/fake-supabase";
import { ingestInstagramComment, ingestInstagramMessage, ingestInstagramQuickReply } from "@/lib/automation/ingest";
import { recordOutboundMessage } from "@/lib/automation/messages";
import { countUnreadConversations, listConversations, loadConversationTimeline, markConversationRead } from "@/lib/inbox/repo";
import { buildInboxHref, parseInboxFilter, parseInboxPage } from "@/lib/inbox/url";
import { hasDraftText, isNearScrollEnd } from "@/lib/inbox/view";
import { normalizeMetaWebhookPayload } from "@/lib/meta/events";
import { buildChannelSwitchHref } from "@/lib/channel/url";
import { formatDeliveryLabel, formatUnreadBadge } from "@/lib/ui/format";
import { encryptToken } from "@/lib/meta/token-crypto";
import type { InstagramCommentReceived, InstagramMessageReceived } from "@/lib/meta/events";
import type { MetaClient } from "@/lib/meta/client";

process.env.META_TOKEN_ENCRYPTION_KEY ??= "test-key-fake-supabase-ingest-suite";

const socialAccount = {
  id: "sa1",
  workspace_id: "ws1",
  profile_id: "profile1",
  external_account_id: "ig-account-1",
  access_token_encrypted: encryptToken("token-falso"),
};

function fakeMeta(): MetaClient {
  return {
    sendPublicReply: vi.fn().mockResolvedValue(undefined),
    sendPrivateReply: vi.fn().mockResolvedValue({ externalMessageId: "m1" }),
    sendTextMessage: vi.fn().mockResolvedValue({ externalMessageId: "m2" }),
    sendQuickReplies: vi.fn().mockResolvedValue({ externalMessageId: "m3" }),
    sendButtonTemplate: vi.fn().mockResolvedValue({ externalMessageId: "m4" }),
  };
}

function seedConversation(overrides: Record<string, unknown> = {}) {
  const fake = createFakeSupabase();
  fake.__tables.contacts.push({ id: "contact1", workspace_id: "ws1", platform: "instagram", platform_user_id: "user-1" });
  fake.__tables.conversations.push({
    id: "conv1",
    workspace_id: "ws1",
    social_account_id: "sa1",
    contact_id: "contact1",
    automation_enabled: true,
    unread_inbound_count: 0,
    last_inbound_at: null,
    last_message_at: null,
    ...overrides,
  });
  return fake;
}

const conversationOf = (fake: ReturnType<typeof createFakeSupabase>) => fake.__tables.conversations[0];

const comment: InstagramCommentReceived = {
  type: "InstagramCommentReceived",
  externalAccountId: "ig-account-1",
  externalCommentId: "c1",
  externalMediaId: "media1",
  parentCommentId: null,
  fromUserId: "user-1",
  fromUsername: "alguem",
  text: "eu quero",
  timestamp: new Date().toISOString(),
};

const dm: InstagramMessageReceived = {
  type: "InstagramMessageReceived",
  externalAccountId: "ig-account-1",
  externalMessageId: "mid-1",
  fromUserId: "user-1",
  text: "oi",
  timestamp: new Date().toISOString(),
};

describe("não lidas: só o que a pessoa manda conta", () => {
  it("comentário novo soma uma não lida e sobe a conversa", async () => {
    const fake = seedConversation();
    await ingestInstagramComment(fake as never, fakeMeta(), socialAccount, comment);
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
    expect(conversationOf(fake).last_inbound_at).toBeTruthy();
    expect(conversationOf(fake).last_message_at).toBe(conversationOf(fake).last_inbound_at);
  });

  it("DM recebida soma uma não lida", async () => {
    const fake = seedConversation();
    await ingestInstagramMessage(fake as never, socialAccount, dm);
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
  });

  it("toque em botão soma uma não lida, mesmo em operação manual", async () => {
    const fake = seedConversation({ automation_enabled: false });
    fake.__tables.automation_runs.push({ id: "run1", workspace_id: "ws1", conversation_id: "conv1", status: "waiting", waiting_reason: "quick_reply" });

    const result = await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, {
      type: "InstagramQuickReplyReceived",
      externalAccountId: "ig-account-1",
      externalMessageId: null,
      fromUserId: "user-1",
      payload: "run1:node1:opt1",
      buttonTitle: "Quero",
      timestamp: new Date().toISOString(),
    });

    expect(result.reason).toBe("AUTOMATION_DISABLED_HUMAN_TAKEOVER");
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
  });

  it("mensagem enviada pela automação ou por humano nunca marca não lida", async () => {
    const fake = seedConversation();
    for (const origin of ["automation", "manual"] as const) {
      await recordOutboundMessage(fake as never, {
        workspaceId: "ws1",
        conversationId: "conv1",
        externalMessageId: `out-${origin}`,
        type: "text",
        text: "resposta",
        origin,
      });
    }
    expect(conversationOf(fake).unread_inbound_count).toBe(0);
    expect(conversationOf(fake).last_inbound_at).toBeNull();
    expect(conversationOf(fake).last_message_at).toBeTruthy(); // atividade continua registrada
    expect(fake.__rpcCalls).toHaveLength(0);

    const { conversations } = await listConversations(fake as never, "ws1");
    expect(conversations[0]).toMatchObject({ unread: false, unreadCount: 0 });
  });

  it("conversa em operação manual também sobe e marca não lida no comentário", async () => {
    const fake = seedConversation({ automation_enabled: false });
    const result = await ingestInstagramComment(fake as never, fakeMeta(), socialAccount, comment);
    expect(result.reason).toBe("AUTOMATION_DISABLED_HUMAN_TAKEOVER");
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
  });
});

describe("não lidas: reenvio do webhook não conta em dobro", () => {
  it("mesma DM duas vezes: uma mensagem e uma não lida", async () => {
    const fake = seedConversation();
    await ingestInstagramMessage(fake as never, socialAccount, dm);
    const second = await ingestInstagramMessage(fake as never, socialAccount, dm);

    expect(second).toEqual({ processed: false, reason: "DUPLICATE_MESSAGE_IGNORED" });
    expect(fake.__tables.messages).toHaveLength(1);
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
  });

  it("dois workers ao mesmo tempo: o índice único barra e não conta", async () => {
    const fake = seedConversation();
    fake.__failNextInsertAsDuplicate("messages");

    const result = await ingestInstagramMessage(fake as never, socialAccount, dm);

    expect(result.reason).toBe("DUPLICATE_MESSAGE_IGNORED");
    expect(conversationOf(fake).unread_inbound_count).toBe(0);
    expect(fake.__rpcCalls).toHaveLength(0);
  });

  it("mesmo comentário reenviado conta uma vez", async () => {
    const fake = seedConversation();
    await ingestInstagramComment(fake as never, fakeMeta(), socialAccount, comment);
    await ingestInstagramComment(fake as never, fakeMeta(), socialAccount, comment);
    expect(fake.__tables.comments).toHaveLength(1);
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
  });

  it("retry do worker dentro da janela de recuperação não conta de novo", async () => {
    const fake = seedConversation();
    fake.__tables.comments.push({
      id: "ja-gravado",
      social_account_id: "sa1",
      external_comment_id: "c1",
      created_at: new Date().toISOString(),
    });
    const result = await ingestInstagramComment(fake as never, fakeMeta(), socialAccount, comment);
    expect(result).toEqual({ processed: true });
    expect(conversationOf(fake).unread_inbound_count).toBe(0);
  });

  it("clique em botão repetido conta uma vez: o claim do run só deixa passar um", async () => {
    const fake = seedConversation();
    fake.__tables.automation_runs.push({ id: "run1", workspace_id: "ws1", conversation_id: "conv1", status: "waiting", waiting_reason: "quick_reply" });
    const click = {
      type: "InstagramQuickReplyReceived" as const,
      externalAccountId: "ig-account-1",
      externalMessageId: null,
      fromUserId: "user-1",
      payload: "run1:node1:opt1",
      buttonTitle: "Quero",
      timestamp: new Date().toISOString(),
    };
    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, click);
    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, click);
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
  });
});

describe("toque em botão sem run para retomar", () => {
  const KEY = "postback:user-1:1893456000123:run1:node1:opt1";
  const tap = (overrides: Record<string, unknown> = {}) => ({
    type: "InstagramQuickReplyReceived" as const,
    externalAccountId: "ig-account-1",
    externalMessageId: KEY as string | null,
    fromUserId: "user-1",
    payload: "run1:node1:opt1",
    buttonTitle: "Quero",
    timestamp: new Date().toISOString(),
    ...overrides,
  });
  const run = (status: string) => ({ id: "run1", workspace_id: "ws1", conversation_id: "conv1", status, waiting_reason: "quick_reply" });

  it("run já encerrada: grava o toque, sobe a conversa e não mexe na run", async () => {
    const fake = seedConversation();
    fake.__tables.automation_runs.push(run("completed"));

    const result = await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap());

    expect(result.reason).toBe("RUN_JA_RETOMADO_OU_NAO_ENCONTRADO");
    expect(fake.__tables.messages).toHaveLength(1);
    expect(fake.__tables.messages[0]).toMatchObject({ direction: "inbound", type: "quick_reply", text: "Quero", external_message_id: KEY });
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
    expect(conversationOf(fake).last_inbound_at).toBeTruthy();
    expect(fake.__tables.automation_runs[0].status).toBe("completed");
  });

  it("payload não reconhecido também conta como entrada da pessoa", async () => {
    const fake = seedConversation();
    const result = await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap({ payload: "icebreaker" }));
    expect(result.reason).toBe("PAYLOAD_NAO_RECONHECIDO");
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
  });

  it("reenvio do mesmo toque conta uma vez; novo toque no mesmo botão conta de novo", async () => {
    const fake = seedConversation();
    fake.__tables.automation_runs.push(run("completed"));

    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap());
    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap());
    expect(fake.__tables.messages).toHaveLength(1);
    expect(conversationOf(fake).unread_inbound_count).toBe(1);

    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap({ externalMessageId: "postback:user-1:1893456999000:run1:node1:opt1" }));
    expect(conversationOf(fake).unread_inbound_count).toBe(2);
  });

  it("o toque que retomou a run e o reenvio depois dela contam uma vez", async () => {
    const fake = seedConversation({ automation_enabled: false });
    fake.__tables.automation_runs.push(run("waiting"));

    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap());
    fake.__tables.automation_runs[0].status = "completed";
    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap());

    expect(fake.__tables.messages).toHaveLength(1);
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
  });

  it("reprocessar em operação manual, com a run de volta em waiting, não duplica", async () => {
    const fake = seedConversation({ automation_enabled: false });
    fake.__tables.automation_runs.push(run("waiting"));

    const first = await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap());
    const second = await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap());

    expect(first.reason).toBe("AUTOMATION_DISABLED_HUMAN_TAKEOVER");
    expect(second.reason).toBe("AUTOMATION_DISABLED_HUMAN_TAKEOVER");
    expect(fake.__tables.messages).toHaveLength(1);
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
  });

  it("sem conversa ou contato conhecido, não cria nada", async () => {
    const fake = createFakeSupabase();
    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap());
    expect(fake.__tables.contacts).toHaveLength(0);
    expect(fake.__tables.conversations).toHaveLength(0);
    expect(fake.__tables.messages).toHaveLength(0);
  });

  it("sem chave estável, não grava para não contar em dobro no reenvio", async () => {
    const fake = seedConversation();
    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap({ externalMessageId: null }));
    expect(fake.__tables.messages).toHaveLength(0);
    expect(conversationOf(fake).unread_inbound_count).toBe(0);
  });

  it("toque vindo da própria conta não conta", async () => {
    const fake = seedConversation();
    fake.__tables.contacts.push({ id: "conta", workspace_id: "ws1", platform: "instagram", platform_user_id: "ig-account-1" });
    fake.__tables.conversations.push({ id: "conv-conta", workspace_id: "ws1", social_account_id: "sa1", contact_id: "conta", unread_inbound_count: 0 });
    await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, tap({ fromUserId: "ig-account-1" }));
    expect(fake.__tables.messages).toHaveLength(0);
  });
});

describe("falha ao gravar a entrada da pessoa", () => {
  const FAILURE = { code: "08006", message: "conexão caiu" };

  it("DM: erro real lança para o QStash repetir e a repetição grava uma vez", async () => {
    const fake = seedConversation();
    fake.__failNextInsert("messages", FAILURE);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ingestInstagramMessage(fake as never, socialAccount, dm)).rejects.toThrow("conexão caiu");
    expect(fake.__tables.messages).toHaveLength(0);
    expect(conversationOf(fake).unread_inbound_count).toBe(0);

    await expect(ingestInstagramMessage(fake as never, socialAccount, dm)).resolves.toEqual({ processed: true });
    expect(conversationOf(fake).unread_inbound_count).toBe(1);
    spy.mockRestore();
  });

  it("toque que reivindicou a run não lança: ela não pode ficar presa em running", async () => {
    const fake = seedConversation({ automation_enabled: false });
    fake.__tables.automation_runs.push({ id: "run1", workspace_id: "ws1", conversation_id: "conv1", status: "waiting", waiting_reason: "quick_reply" });
    fake.__failNextInsert("messages", FAILURE);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, {
      type: "InstagramQuickReplyReceived",
      externalAccountId: "ig-account-1",
      externalMessageId: "postback:k",
      fromUserId: "user-1",
      payload: "run1:node1:opt1",
      buttonTitle: "Quero",
      timestamp: new Date().toISOString(),
    });

    expect(result.reason).toBe("AUTOMATION_DISABLED_HUMAN_TAKEOVER");
    expect(fake.__tables.automation_runs[0].status).toBe("waiting");
    spy.mockRestore();
  });

  it("toque sem run lança, porque nenhuma run foi reivindicada", async () => {
    const fake = seedConversation();
    fake.__failNextInsert("messages", FAILURE);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(
      ingestInstagramQuickReply(fake as never, fakeMeta(), socialAccount, {
        type: "InstagramQuickReplyReceived",
        externalAccountId: "ig-account-1",
        externalMessageId: "postback:k",
        fromUserId: "user-1",
        payload: "icebreaker",
        buttonTitle: "Quero",
        timestamp: new Date().toISOString(),
      })
    ).rejects.toThrow("conexão caiu");
    spy.mockRestore();
  });
});

describe("parser: chave do toque em botão", () => {
  const ACCOUNT = "ig-account-1";
  const envelope = (value: Record<string, unknown>, time: number | undefined = 1893456000) =>
    normalizeMetaWebhookPayload({ entry: [{ id: ACCOUNT, time, changes: [{ field: "messaging_postbacks", value }] }] });
  const postback = { sender: { id: "user-1" }, recipient: { id: ACCOUNT }, timestamp: 1893456000123, postback: { title: "Quero", payload: "run1:node1:opt1" } };

  it("usa postback.mid quando a Meta manda", () => {
    expect(envelope({ ...postback, postback: { ...postback.postback, mid: "mid-do-toque" } })[0]).toMatchObject({ externalMessageId: "mid-do-toque" });
  });

  it("sem mid, deriva do próprio evento e repete no reenvio", () => {
    const expected = "postback:user-1:1893456000123:run1:node1:opt1";
    expect(envelope(postback)[0]).toMatchObject({ externalMessageId: expected });
    expect(envelope(postback, 1893459999)[0]).toMatchObject({ externalMessageId: expected });
  });

  it("outro horário é outro toque", () => {
    const first = envelope(postback)[0] as { externalMessageId: string };
    const second = envelope({ ...postback, timestamp: 1893456999000 })[0] as { externalMessageId: string };
    expect(first.externalMessageId).not.toBe(second.externalMessageId);
  });

  it("sem timestamp no evento, usa o horário do entry", () => {
    const { timestamp: _omit, ...withoutTimestamp } = postback;
    void _omit;
    expect(envelope(withoutTimestamp)[0]).toMatchObject({ externalMessageId: "postback:user-1:1893456000:run1:node1:opt1" });
  });

  it("sem horário nenhum não inventa chave", () => {
    const { timestamp: _omit, ...withoutTimestamp } = postback;
    void _omit;
    const events = normalizeMetaWebhookPayload({ entry: [{ id: ACCOUNT, changes: [{ field: "messaging_postbacks", value: withoutTimestamp }] }] });
    expect(events[0]).toMatchObject({ externalMessageId: null });
  });

  it("quick reply continua usando o mid da mensagem", () => {
    const events = normalizeMetaWebhookPayload({
      entry: [{ id: ACCOUNT, messaging: [{ sender: { id: "user-1" }, timestamp: 1893456000123, message: { mid: "mid-qr", text: "Quero", quick_reply: { payload: "run1:node1:opt1" } } }] }],
    });
    expect(events[0]).toMatchObject({ type: "InstagramQuickReplyReceived", externalMessageId: "mid-qr" });
  });
});

describe("não lidas: a contagem nunca impede a automação", () => {
  it("erro da RPC não barra o comentário e a conversa ainda sobe", async () => {
    const fake = seedConversation();
    fake.__setRpcError({ message: "function does not exist" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await ingestInstagramComment(fake as never, fakeMeta(), socialAccount, comment);

    expect(result).toEqual({ processed: true });
    expect(conversationOf(fake).last_message_at).toBeTruthy();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it("exceção na RPC também não derruba o worker", async () => {
    const fake = seedConversation();
    fake.rpc = (() => {
      throw new Error("rede fora");
    }) as never;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(ingestInstagramMessage(fake as never, socialAccount, dm)).resolves.toEqual({ processed: true });
    spy.mockRestore();
  });
});

describe("lista: ordem, filtro e páginas", () => {
  function conversation(id: string, overrides: Record<string, unknown>) {
    return {
      id,
      workspace_id: "ws1",
      social_account_id: "sa1",
      contact_id: `contact-${id}`,
      automation_enabled: true,
      unread_inbound_count: 0,
      last_inbound_at: null,
      last_message_at: null,
      contact: { username: id, avatar_url: null, platform: "instagram" },
      social_account: { username: "conta" },
      ...overrides,
    };
  }

  it("ordena pela última entrada da pessoa; sem entrada vão depois, por last_message_at", async () => {
    const fake = createFakeSupabase();
    fake.__tables.conversations.push(
      conversation("so-automacao-recente", { last_message_at: "2026-11-09T12:00:00.000Z" }),
      conversation("entrada-antiga", { last_inbound_at: "2026-11-01T00:00:00.000Z", last_message_at: "2026-11-09T11:00:00.000Z" }),
      conversation("entrada-nova", { last_inbound_at: "2026-11-08T00:00:00.000Z", last_message_at: "2026-11-08T00:00:00.000Z" }),
      conversation("so-automacao-antiga", { last_message_at: "2026-11-02T00:00:00.000Z" })
    );

    const { conversations } = await listConversations(fake as never, "ws1");

    expect(conversations.map((c) => c.id)).toEqual(["entrada-nova", "entrada-antiga", "so-automacao-recente", "so-automacao-antiga"]);
  });

  it("filtro de não lidas é aplicado antes do corte da página", async () => {
    const fake = createFakeSupabase();
    // 60 conversas lidas e mais recentes: filtrar depois do corte devolveria vazio.
    for (let i = 0; i < 60; i++) {
      fake.__tables.conversations.push(conversation(`lida-${i}`, { last_inbound_at: `2026-11-09T10:${String(i).padStart(2, "0")}:00.000Z` }));
    }
    fake.__tables.conversations.push(
      conversation("nao-lida", { unread_inbound_count: 3, last_inbound_at: "2026-10-01T00:00:00.000Z" }),
      conversation("de-outro-workspace", { workspace_id: "ws2", unread_inbound_count: 9, last_inbound_at: "2026-11-09T00:00:00.000Z" })
    );

    const { conversations } = await listConversations(fake as never, "ws1", { unreadOnly: true });

    expect(conversations.map((c) => c.id)).toEqual(["nao-lida"]);
    expect(conversations[0]).toMatchObject({ unread: true, unreadCount: 3 });
  });

  it("passa de 50 conversas por páginas, sem repetir nem perder", async () => {
    const fake = createFakeSupabase();
    for (let i = 0; i < 120; i++) {
      fake.__tables.conversations.push(conversation(`c${String(i).padStart(3, "0")}`, { last_inbound_at: "2026-11-09T00:00:00.000Z" }));
    }

    const seen: string[] = [];
    const flags: boolean[] = [];
    for (const page of [1, 2, 3]) {
      const { conversations, hasMore } = await listConversations(fake as never, "ws1", { page });
      seen.push(...conversations.map((c) => c.id));
      flags.push(hasMore);
    }

    expect(new Set(seen).size).toBe(120);
    expect(flags).toEqual([true, true, false]);
  });

  it("prévia correta em cada página e sem misturar comentário de outra conta", async () => {
    const fake = createFakeSupabase();
    for (let i = 0; i < 55; i++) {
      fake.__tables.conversations.push(
        conversation(`c${String(i).padStart(2, "0")}`, { contact_id: `contact-${i}`, last_inbound_at: "2026-11-09T00:00:00.000Z" })
      );
    }
    fake.__tables.messages.push({ conversation_id: "c54", text: "mensagem da página 2", created_at: "2026-11-09T10:00:00.000Z" });
    fake.__tables.comments.push(
      { social_account_id: "sa1", contact_id: "contact-0", text: "comentário certo", created_at: "2026-11-09T09:00:00.000Z" },
      { social_account_id: "outra-conta", contact_id: "contact-0", text: "comentário de outra conta", created_at: "2026-11-09T11:00:00.000Z" }
    );

    const first = await listConversations(fake as never, "ws1", { page: 1 });
    const second = await listConversations(fake as never, "ws1", { page: 2 });

    expect(first.conversations.find((c) => c.id === "c00")?.previewText).toBe("comentário certo");
    expect(second.conversations.find((c) => c.id === "c54")?.previewText).toBe("mensagem da página 2");
  });

  it("conversa muito movimentada não apaga a prévia das outras da página", async () => {
    const fake = createFakeSupabase();
    fake.__tables.conversations.push(
      conversation("movimentada", { last_inbound_at: "2026-11-09T00:00:00.000Z" }),
      conversation("calma", { last_inbound_at: "2026-11-08T00:00:00.000Z" })
    );
    for (let i = 0; i < 400; i++) {
      fake.__tables.messages.push({ conversation_id: "movimentada", text: `m${i}`, created_at: `2026-11-09T${String(10 + (i % 10)).padStart(2, "0")}:00:00.000Z` });
    }
    fake.__tables.messages.push({ conversation_id: "calma", text: "única mensagem", created_at: "2026-11-01T00:00:00.000Z" });

    const { conversations } = await listConversations(fake as never, "ws1");

    expect(conversations.find((c) => c.id === "calma")?.previewText).toBe("única mensagem");
  });

  it("prévia sem texto: DM não vira comentário nem 'sem mensagens'", async () => {
    const fake = createFakeSupabase();
    fake.__tables.conversations.push(
      conversation("so-anexo", { contact_id: "c-a", last_inbound_at: "2026-11-09T04:00:00.000Z" }),
      conversation("anexo-depois-de-comentario", { contact_id: "c-b", last_inbound_at: "2026-11-09T03:00:00.000Z" }),
      conversation("comentario-sem-texto", { contact_id: "c-c", last_inbound_at: "2026-11-09T02:00:00.000Z" }),
      conversation("vazia", { contact_id: "c-d", last_inbound_at: "2026-11-09T01:00:00.000Z" })
    );
    fake.__tables.messages.push(
      { conversation_id: "so-anexo", text: null, created_at: "2026-11-09T10:00:00.000Z" },
      { conversation_id: "anexo-depois-de-comentario", text: null, created_at: "2026-11-09T10:00:00.000Z" }
    );
    fake.__tables.comments.push(
      { social_account_id: "sa1", contact_id: "c-b", text: "comentei antes", created_at: "2026-11-09T09:00:00.000Z" },
      { social_account_id: "sa1", contact_id: "c-c", text: null, created_at: "2026-11-09T09:00:00.000Z" }
    );

    const { conversations } = await listConversations(fake as never, "ws1");
    const previewOf = (id: string) => conversations.find((c) => c.id === id)?.previewText;

    expect(previewOf("so-anexo")).toBe("Mensagem sem texto");
    expect(previewOf("anexo-depois-de-comentario")).toBe("Mensagem sem texto");
    expect(previewOf("comentario-sem-texto")).toBe("Comentário recebido");
    expect(previewOf("vazia")).toBeNull();
  });

  it("total de não lidas respeita workspace e canal", async () => {
    const fake = createFakeSupabase();
    fake.__tables.conversations.push(
      conversation("a", { unread_inbound_count: 2 }),
      conversation("b", { unread_inbound_count: 1, social_account_id: "sa2" }),
      conversation("c", { unread_inbound_count: 0 }),
      conversation("d", { unread_inbound_count: 5, workspace_id: "ws2" })
    );
    expect(await countUnreadConversations(fake as never, "ws1")).toBe(2);
    expect(await countUnreadConversations(fake as never, "ws1", { socialAccountId: "sa2" })).toBe(1);
  });
});

describe("abrir a conversa", () => {
  it("zera as não lidas e grava last_read_at", async () => {
    const fake = seedConversation({ unread_inbound_count: 4 });
    await markConversationRead(fake as never, "conv1", "ws1");
    expect(conversationOf(fake).unread_inbound_count).toBe(0);
    expect(conversationOf(fake).last_read_at).toBeTruthy();
  });

  it("não mexe em conversa de outro workspace", async () => {
    const fake = seedConversation({ unread_inbound_count: 4 });
    await markConversationRead(fake as never, "conv1", "ws-de-outro");
    expect(conversationOf(fake).unread_inbound_count).toBe(4);
    expect(conversationOf(fake).last_read_at).toBeUndefined();
  });

  it("sem não lidas não grava nada, para o tempo real não entrar em ciclo", async () => {
    const fake = seedConversation({ unread_inbound_count: 0 });
    await markConversationRead(fake as never, "conv1", "ws1");
    expect(conversationOf(fake).last_read_at).toBeUndefined();
  });
});

describe("contato", () => {
  it("DM sem username não apaga o @ já conhecido", async () => {
    const fake = seedConversation();
    fake.__tables.contacts[0].username = "paulo";
    await ingestInstagramMessage(fake as never, socialAccount, dm);
    expect(fake.__tables.contacts[0].username).toBe("paulo");
  });
});

describe("código no ar antes da migration", () => {
  const PENDING = ["last_inbound_at", "unread_inbound_count", "read_at"];

  function seeded() {
    const fake = seedConversation({ last_message_at: "2026-11-09T10:00:00.000Z" });
    fake.__setMissingColumns(...PENDING);
    return fake;
  }

  it("a lista continua aparecendo, sem contagem", async () => {
    const { conversations } = await listConversations(seeded() as never, "ws1");
    expect(conversations.map((c) => c.id)).toEqual(["conv1"]);
    expect(conversations[0]).toMatchObject({ unread: false, unreadCount: 0 });
  });

  it("filtro de não lidas fica vazio, sem erro", async () => {
    await expect(listConversations(seeded() as never, "ws1", { unreadOnly: true })).resolves.toEqual({ conversations: [], hasMore: false });
  });

  it("total devolve 0", async () => {
    await expect(countUnreadConversations(seeded() as never, "ws1")).resolves.toBe(0);
  });

  it("abrir a conversa ainda grava last_read_at", async () => {
    const fake = seeded();
    await markConversationRead(fake as never, "conv1", "ws1");
    expect(conversationOf(fake).last_read_at).toBeTruthy();
  });

  it("a timeline continua mostrando as mensagens", async () => {
    const fake = seeded();
    fake.__tables.messages.push({ id: "m1", conversation_id: "conv1", text: "oi", direction: "outbound", origin: "manual", status: "sent", created_at: "2026-11-09T10:00:00.000Z", sent_at: "2026-11-09T10:00:00.000Z", received_at: null });

    const { timeline } = await loadConversationTimeline(fake as never, { conversationId: "conv1", contactId: "contact1", socialAccountId: "sa1" });

    expect(timeline.map((e) => e.id)).toEqual(["msg-m1"]);
    expect(timeline[0].delivery).toEqual({ state: "sent" });
  });
});

describe("timeline: limite corta o começo, nunca o fim", () => {
  it("com mais de 300 mensagens, a mais nova continua na conversa", async () => {
    const fake = seedConversation();
    for (let i = 0; i < 320; i++) {
      const at = new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString();
      fake.__tables.messages.push({ id: `m${i}`, conversation_id: "conv1", text: `t${i}`, direction: "inbound", created_at: at, sent_at: null, received_at: at });
    }

    const { timeline } = await loadConversationTimeline(fake as never, { conversationId: "conv1", contactId: "contact1", socialAccountId: "sa1" });

    expect(timeline).toHaveLength(300);
    expect(timeline[timeline.length - 1].id).toBe("msg-m319");
  });
});

describe("formatação", () => {
  it("badge: número até 99, depois 99+", () => {
    expect(formatUnreadBadge(1)).toBe("1");
    expect(formatUnreadBadge(99)).toBe("99");
    expect(formatUnreadBadge(100)).toBe("99+");
    expect(formatUnreadBadge(4321)).toBe("99+");
  });

  it("badge: nada quando não há não lidas", () => {
    expect(formatUnreadBadge(0)).toBeNull();
    expect(formatUnreadBadge(-1)).toBeNull();
    expect(formatUnreadBadge(Number.NaN)).toBeNull();
  });

  it("indicador da DM: Enviada, Visualizada no horário de Brasília e falha", () => {
    expect(formatDeliveryLabel({ state: "sent" })).toBe("Enviada");
    expect(formatDeliveryLabel({ state: "seen", at: "2026-11-09T21:30:00.000Z" })).toBe("Visualizada 18:30");
    expect(formatDeliveryLabel({ state: "failed" })).toBe("Falha no envio");
  });
});

describe("regras da tela", () => {
  it("campo com texto segura a atualização; vazio ou só espaços não", () => {
    expect(hasDraftText([{ value: "" }, { value: "resposta longa" }])).toBe(true);
    expect(hasDraftText([{ value: "   \n" }])).toBe(false);
    expect(hasDraftText([])).toBe(false);
  });

  it("acompanha o fim só quando já está perto dele", () => {
    expect(isNearScrollEnd({ scrollHeight: 1000, scrollTop: 600, clientHeight: 400 })).toBe(true);
    expect(isNearScrollEnd({ scrollHeight: 1000, scrollTop: 500, clientHeight: 400 })).toBe(true);
    expect(isNearScrollEnd({ scrollHeight: 1000, scrollTop: 100, clientHeight: 400 })).toBe(false);
  });
});

describe("URL da lista", () => {
  it("filtro preserva canal e ignora valores desconhecidos", () => {
    expect(buildInboxHref({ channelId: "sa1", filter: "unread" })).toBe("/dashboard/inbox?channel=sa1&filter=unread");
    expect(buildInboxHref({ channelId: "sa1", filter: "all" })).toBe("/dashboard/inbox?channel=sa1");
    expect(parseInboxFilter("unread")).toBe("unread");
    expect(parseInboxFilter("qualquer")).toBe("all");
    expect(parseInboxFilter(undefined)).toBe("all");
  });

  it("link da conversa leva canal, filtro e página", () => {
    expect(buildInboxHref({ channelId: "sa1", filter: "unread", page: 2, conversationId: "c1" })).toBe(
      "/dashboard/inbox?channel=sa1&filter=unread&page=2&conversation=c1"
    );
  });

  it("página inválida vira 1", () => {
    expect(parseInboxPage("3")).toBe(3);
    expect(parseInboxPage("0")).toBe(1);
    expect(parseInboxPage("-2")).toBe(1);
    expect(parseInboxPage("abc")).toBe(1);
    expect(parseInboxPage(undefined)).toBe(1);
  });

  it("trocar de canal volta para a primeira página e mantém o filtro", () => {
    const current = new URLSearchParams({ channel: "sa1", filter: "unread", page: "4", conversation: "c1" });
    expect(buildChannelSwitchHref("/dashboard/inbox", current, "sa2")).toBe("/dashboard/inbox?channel=sa2&filter=unread");
  });
});
