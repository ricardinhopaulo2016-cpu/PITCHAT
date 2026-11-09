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

  const params = {
    accessToken: "token-abc",
    igUserId: "ig1",
    commentId: "c1",
    text: "Quer receber o vídeo?",
    quickReplies: [{ title: "Me manda o vídeo", payload: "run1:priv:video" }],
  };
  const asTemplate = {
    recipient: { comment_id: "c1" },
    message: {
      attachment: {
        type: "template",
        payload: {
          template_type: "button",
          text: "Quer receber o vídeo?",
          buttons: [{ type: "postback", title: "Me manda o vídeo", payload: "run1:priv:video" }],
        },
      },
    },
  };
  const asQuickReplies = {
    recipient: { comment_id: "c1" },
    message: {
      text: "Quer receber o vídeo?",
      quick_replies: [{ content_type: "text", title: "Me manda o vídeo", payload: "run1:priv:video" }],
    },
  };
  const failure = (status: number, code: number) => ({
    ok: false,
    status,
    json: async () => ({ error: { message: "recusado", code } }),
  });

  it("manda botão de verdade (postback) quando há opções", async () => {
    const fetchMock = fetchReturning({ message_id: "m2" });
    vi.stubGlobal("fetch", fetchMock);

    await realMetaClient.sendPrivateReply(params);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(asTemplate);
  });

  it("cai em quick_replies quando a Meta recusa o template", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(failure(400, 100))
      .mockResolvedValueOnce({ ok: true, json: async () => ({ message_id: "m3" }) });
    vi.stubGlobal("fetch", fetchMock);

    const result = await realMetaClient.sendPrivateReply(params);

    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual(asQuickReplies);
    expect(result).toEqual({ externalMessageId: "m3", format: "quick_replies" });
  });

  it("informa qual formato a Meta aceitou", async () => {
    vi.stubGlobal("fetch", fetchReturning({ message_id: "m5" }));
    await expect(realMetaClient.sendPrivateReply(params)).resolves.toEqual({ externalMessageId: "m5", format: "button_template" });
  });

  it.each([
    ["token inválido", 401, 190],
    ["rate limit", 400, 4],
  ])("não reenvia em outro formato com %s", async (_nome, status, code) => {
    const fetchMock = vi.fn().mockResolvedValue(failure(status, code));
    vi.stubGlobal("fetch", fetchMock);

    await expect(realMetaClient.sendPrivateReply(params)).rejects.toThrow("recusado");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("usa quick_replies quando as opções não cabem em botões", async () => {
    const fetchMock = fetchReturning({ message_id: "m4" });
    vi.stubGlobal("fetch", fetchMock);
    const quickReplies = ["a", "b", "c", "d"].map((title) => ({ title, payload: `run1:priv:${title}` }));

    await realMetaClient.sendPrivateReply({ ...params, quickReplies });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).message.quick_replies).toHaveLength(4);
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
