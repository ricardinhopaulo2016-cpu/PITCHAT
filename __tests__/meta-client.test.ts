import { afterEach, describe, expect, it, vi } from "vitest";
import { classifyMetaError, realMetaClient } from "@/lib/meta/client";

describe("classifyMetaError", () => {
  it("trata códigos de rate limit (4, 17, 32, 613) como retryable, mesmo com status HTTP não-óbvio", () => {
    expect(classifyMetaError(200, 4)).toBe("RETRYABLE");
    expect(classifyMetaError(400, 17)).toBe("RETRYABLE");
    expect(classifyMetaError(403, 32)).toBe("RETRYABLE");
    expect(classifyMetaError(400, 613)).toBe("RETRYABLE");
  });

  it("trata token expirado/inválido (190) como non-retryable — nunca adianta tentar de novo sem reautenticar", () => {
    expect(classifyMetaError(401, 190)).toBe("NON_RETRYABLE");
  });

  it("cai pro status HTTP quando não tem código de erro reconhecido", () => {
    expect(classifyMetaError(429)).toBe("RETRYABLE");
    expect(classifyMetaError(503)).toBe("RETRYABLE");
    expect(classifyMetaError(400)).toBe("NON_RETRYABLE");
    expect(classifyMetaError(422, 999)).toBe("NON_RETRYABLE");
  });
});

function fetchReturning(json: unknown) {
  return vi.fn().mockResolvedValue({ ok: true, json: async () => json });
}

describe("realMetaClient.sendPrivateReply", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("manda só {text} quando quickReplies não é passado — comportamento original, inalterado", async () => {
    const fetchMock = fetchReturning({ message_id: "m1" });
    vi.stubGlobal("fetch", fetchMock);

    await realMetaClient.sendPrivateReply({
      accessToken: "token-abc",
      igUserId: "ig1",
      commentId: "c1",
      text: "Oi!",
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      recipient: { comment_id: "c1" },
      message: { text: "Oi!" },
    });
  });

  // Achado real 24/09/2026: tentativa de resolver a bubble duplicada
  // (PRIVATE_REPLY + QUICK_REPLY separados com o mesmo texto) anexando os
  // botões NA MESMA private reply — a doc oficial só mostra {text} no
  // exemplo, nunca confirma nem nega quick_replies aqui. Formato do campo
  // idêntico ao do Send API padrão (quick-replies.md, confirmado).
  it("anexa quick_replies na mesma mensagem quando passado", async () => {
    const fetchMock = fetchReturning({ message_id: "m2" });
    vi.stubGlobal("fetch", fetchMock);

    await realMetaClient.sendPrivateReply({
      accessToken: "token-abc",
      igUserId: "ig1",
      commentId: "c1",
      text: "Quer receber o vídeo?",
      quickReplies: [{ title: "Me manda o vídeo", payload: "run1:priv:video" }],
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      recipient: { comment_id: "c1" },
      message: {
        text: "Quer receber o vídeo?",
        quick_replies: [{ content_type: "text", title: "Me manda o vídeo", payload: "run1:priv:video" }],
      },
    });
  });
});

describe("realMetaClient.sendButtonTemplate", () => {
  afterEach(() => vi.unstubAllGlobals());

  // Formato confirmado na doc oficial de Button Template em 24/09/2026 —
  // GET https://developers.facebook.com/docs/instagram-platform/.../button-template
  it("monta o Button Template com o formato exato da doc oficial (attachment/template/button)", async () => {
    const fetchMock = fetchReturning({ message_id: "m3" });
    vi.stubGlobal("fetch", fetchMock);

    await realMetaClient.sendButtonTemplate({
      accessToken: "token-abc",
      igUserId: "ig1",
      recipientId: "user1",
      text: "Tá na mão!",
      buttons: [{ type: "web_url", title: "Assistir ao vídeo", url: "https://exemplo.com/v" }],
    });

    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({
      recipient: { id: "user1" },
      message: {
        attachment: {
          type: "template",
          payload: {
            template_type: "button",
            text: "Tá na mão!",
            buttons: [{ type: "web_url", title: "Assistir ao vídeo", url: "https://exemplo.com/v" }],
          },
        },
      },
    });
  });
});

describe("realMetaClient.getCommentTimestamp", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("pede só o campo timestamp e devolve ISO normalizado", async () => {
    const fetchMock = fetchReturning({ id: "c1", timestamp: "2026-11-08T17:00:00+0000" });
    vi.stubGlobal("fetch", fetchMock);

    const result = await realMetaClient.getCommentTimestamp!({ accessToken: "t", commentId: "c1" });

    expect(String(fetchMock.mock.calls[0][0])).toContain("/c1?fields=timestamp");
    expect(result).toBe("2026-11-08T17:00:00.000Z");
  });

  it("devolve null quando a Meta não manda timestamp válido", async () => {
    vi.stubGlobal("fetch", fetchReturning({ id: "c1", timestamp: "lixo" }));
    expect(await realMetaClient.getCommentTimestamp!({ accessToken: "t", commentId: "c1" })).toBeNull();
    vi.stubGlobal("fetch", fetchReturning({ id: "c1" }));
    expect(await realMetaClient.getCommentTimestamp!({ accessToken: "t", commentId: "c1" })).toBeNull();
  });

  it("desiste em até 2s quando a Meta não responde", async () => {
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      realMetaClient.getCommentTimestamp!({ accessToken: "t", commentId: "c1" }),
    ).rejects.toBeDefined();
    expect(timeoutSpy).toHaveBeenCalledWith(2_000);
    timeoutSpy.mockRestore();
  });
});
