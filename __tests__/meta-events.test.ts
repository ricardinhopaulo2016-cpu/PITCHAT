import { describe, expect, it } from "vitest";
import { classifyWebhookEventType, normalizeMetaWebhookPayload } from "@/lib/meta/events";

describe("normalizeMetaWebhookPayload", () => {
  it("normaliza um evento de comentário", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "17841400000000000",
          time: 1893456000,
          changes: [
            {
              field: "comments",
              value: {
                id: "18000000000000000",
                text: "EU QUERO!!",
                from: { id: "1234567890", username: "fulano" },
                media: { id: "18999999999999999" },
              },
            },
          ],
        },
      ],
    };

    const events = normalizeMetaWebhookPayload(payload);
    expect(events).toEqual([
      {
        type: "InstagramCommentReceived",
        externalAccountId: "17841400000000000",
        externalCommentId: "18000000000000000",
        externalMediaId: "18999999999999999",
        parentCommentId: null,
        fromUserId: "1234567890",
        fromUsername: "fulano",
        text: "EU QUERO!!",
        timestamp: new Date(1893456000 * 1000).toISOString(),
      },
    ]);
  });

  it("normaliza um reply a outro comentário (parent_id presente)", () => {
    const payload = {
      entry: [
        {
          id: "acc1",
          changes: [
            {
              field: "comments",
              value: { id: "c2", text: "resposta", from: { id: "u1" }, parent_id: "c1" },
            },
          ],
        },
      ],
    };
    const [event] = normalizeMetaWebhookPayload(payload);
    expect(event).toMatchObject({ parentCommentId: "c1" });
  });

  it("normaliza comentário no formato ALTERNATIVO (field/value direto no entry, sem changes[]) — visto na doc oficial de comment-moderation", () => {
    const payload = {
      object: "instagram",
      entry: [
        {
          id: "17841400000000000",
          time: 1893456000,
          field: "comments",
          value: {
            id: "18000000000000001",
            from: { id: "1234567890", username: "fulano" },
            text: "EU QUERO",
            media: { id: "18999999999999998" },
          },
        },
      ],
    };
    const events = normalizeMetaWebhookPayload(payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "InstagramCommentReceived",
      externalCommentId: "18000000000000001",
      text: "EU QUERO",
    });
  });

  it("ignora changes de field diferente de 'comments'", () => {
    const payload = {
      entry: [{ id: "acc1", changes: [{ field: "mentions", value: { id: "x", text: "y" } }] }],
    };
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
  });

  it("normaliza mensagem de texto recebida", () => {
    const payload = {
      entry: [
        {
          id: "acc1",
          messaging: [
            { sender: { id: "u1" }, recipient: { id: "acc1" }, timestamp: 1893456000000, message: { mid: "m1", text: "oi" } },
          ],
        },
      ],
    };
    expect(normalizeMetaWebhookPayload(payload)).toEqual([
      {
        type: "InstagramMessageReceived",
        externalAccountId: "acc1",
        externalMessageId: "m1",
        fromUserId: "u1",
        text: "oi",
        timestamp: new Date(1893456000000).toISOString(),
      },
    ]);
  });

  it("normaliza quick reply clicado — usa o payload que A GENTE definiu, nunca o título do botão", () => {
    const payload = {
      entry: [
        {
          id: "acc1",
          messaging: [
            {
              sender: { id: "u1" },
              timestamp: 1893456000000,
              message: { mid: "m2", text: "Me manda o vídeo", quick_reply: { payload: "run123:qr1:yes" } },
            },
          ],
        },
      ],
    };
    expect(normalizeMetaWebhookPayload(payload)).toEqual([
      {
        type: "InstagramQuickReplyReceived",
        externalAccountId: "acc1",
        fromUserId: "u1",
        payload: "run123:qr1:yes",
        timestamp: new Date(1893456000000).toISOString(),
      },
    ]);
  });

  it("normaliza postback (botão de template genérico)", () => {
    const payload = {
      entry: [{ id: "acc1", messaging: [{ sender: { id: "u1" }, postback: { payload: "run123:btn1:ok" } }] }],
    };
    const [event] = normalizeMetaWebhookPayload(payload);
    expect(event).toMatchObject({ type: "InstagramQuickReplyReceived", payload: "run123:btn1:ok" });
  });

  it("normaliza mensagem de texto recebida no formato changes[] (field=messages)", () => {
    const payload = {
      entry: [
        {
          id: "acc1",
          time: 1893456000,
          changes: [
            {
              field: "messages",
              value: { sender: { id: "u1" }, recipient: { id: "acc1" }, timestamp: 1893456999, message: { mid: "m1", text: "oi" } },
            },
          ],
        },
      ],
    };
    expect(normalizeMetaWebhookPayload(payload)).toEqual([
      {
        type: "InstagramMessageReceived",
        externalAccountId: "acc1",
        externalMessageId: "m1",
        fromUserId: "u1",
        text: "oi",
        timestamp: new Date(1893456999).toISOString(),
      },
    ]);
  });

  it("normaliza quick reply no formato changes[] (field=messages, value.message.quick_reply)", () => {
    const payload = {
      entry: [
        {
          id: "acc1",
          changes: [
            {
              field: "messages",
              value: { sender: { id: "u1" }, message: { mid: "m2", text: "Me manda o vídeo", quick_reply: { payload: "run123:qr1:yes" } } },
            },
          ],
        },
      ],
    };
    const [event] = normalizeMetaWebhookPayload(payload);
    expect(event).toMatchObject({ type: "InstagramQuickReplyReceived", payload: "run123:qr1:yes" });
  });

  it("normaliza postback no formato changes[] (field=messaging_postbacks)", () => {
    const payload = {
      entry: [
        {
          id: "acc1",
          changes: [{ field: "messaging_postbacks", value: { sender: { id: "u1" }, postback: { payload: "run123:btn1:ok" } } }],
        },
      ],
    };
    const [event] = normalizeMetaWebhookPayload(payload);
    expect(event).toMatchObject({ type: "InstagramQuickReplyReceived", fromUserId: "u1", payload: "run123:btn1:ok" });
  });

  it("ignora evento de messaging sem sender.id (payload malformado) sem lançar exceção", () => {
    const payload = {
      entry: [{ id: "acc1", changes: [{ field: "messages", value: { message: { mid: "m1", text: "oi" } } }] }],
    };
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
  });

  it("lida com múltiplos entries/changes num único payload", () => {
    const payload = {
      entry: [
        { id: "acc1", changes: [{ field: "comments", value: { id: "c1", text: "a", from: { id: "u1" } } }] },
        { id: "acc2", changes: [{ field: "comments", value: { id: "c2", text: "b", from: { id: "u2" } } }] },
      ],
    };
    expect(normalizeMetaWebhookPayload(payload)).toHaveLength(2);
  });

  it("ignora comentário sem id ou sem texto (payload malformado) sem lançar exceção", () => {
    const payload = { entry: [{ id: "acc1", changes: [{ field: "comments", value: { from: { id: "u1" } } }] }] };
    expect(normalizeMetaWebhookPayload(payload)).toEqual([]);
  });

  it("payload vazio retorna lista vazia", () => {
    expect(normalizeMetaWebhookPayload({})).toEqual([]);
  });
});

describe("classifyWebhookEventType", () => {
  it("classifica comments", () => {
    const payload = { entry: [{ id: "acc1", changes: [{ field: "comments", value: { id: "c1", text: "a" } }] }] };
    expect(classifyWebhookEventType(payload)).toBe("comments");
  });

  it("classifica messages vindo em changes[] (não só o formato legado messaging[])", () => {
    const payload = { entry: [{ id: "acc1", changes: [{ field: "messages", value: { sender: { id: "u1" } } }] }] };
    expect(classifyWebhookEventType(payload)).toBe("messages");
  });

  it("classifica messaging_postbacks", () => {
    const payload = { entry: [{ id: "acc1", changes: [{ field: "messaging_postbacks", value: {} }] }] };
    expect(classifyWebhookEventType(payload)).toBe("messaging_postbacks");
  });

  it("classifica formato legado entry.messaging[] como messages", () => {
    const payload = { entry: [{ id: "acc1", messaging: [{ sender: { id: "u1" } }] }] };
    expect(classifyWebhookEventType(payload)).toBe("messages");
  });

  it("olha TODOS os entries, não só o primeiro — payload com comment + message retorna mixed", () => {
    const payload = {
      entry: [
        { id: "acc1", changes: [{ field: "comments", value: { id: "c1", text: "a" } }] },
        { id: "acc1", changes: [{ field: "messages", value: { sender: { id: "u1" } } }] },
      ],
    };
    expect(classifyWebhookEventType(payload)).toBe("mixed");
  });

  it("payload vazio ou irreconhecível retorna unknown", () => {
    expect(classifyWebhookEventType({})).toBe("unknown");
    expect(classifyWebhookEventType({ entry: [{ id: "acc1", changes: [{ field: "mentions", value: {} }] }] })).toBe(
      "unknown"
    );
  });
});
