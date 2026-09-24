import { afterEach, describe, expect, it, vi } from "vitest";
import { advanceRun, buildQuickReplyPayload, parseQuickReplyPayload } from "@/lib/automation/engine";
import { MetaApiError, type MetaClient } from "@/lib/meta/client";
import type { Graph } from "@/lib/automation/graph";
import type { ExecutionContext } from "@/lib/automation/node-handlers";
import { createFakeSupabase } from "./fakes/fake-supabase";
import * as qstash from "@/lib/qstash";

// Default: replica o comportamento real de scheduleAutomationResume sem
// QSTASH_TOKEN configurado (ok:false) — o teste de retry bem-sucedido abaixo
// sobrescreve com mockResolvedValueOnce só na hora que precisa.
vi.mock("@/lib/qstash", () => ({
  scheduleAutomationResume: vi.fn().mockResolvedValue({ ok: false, reason: "QSTASH_NOT_CONFIGURED" }),
}));

const socialAccount = { id: "sa1", externalAccountId: "ig-account-1", accessToken: "token-1" };

function baseCtx(overrides: Partial<ExecutionContext> = {}): ExecutionContext {
  return {
    variables: {},
    triggerText: "EU QUERO",
    contactTags: [],
    customFields: {},
    conversationAutomationEnabled: true,
    ...overrides,
  };
}

function fakeMeta(overrides: Partial<MetaClient> = {}): MetaClient {
  return {
    sendPublicReply: vi.fn().mockResolvedValue(undefined),
    sendPrivateReply: vi.fn().mockResolvedValue({ externalMessageId: "m1" }),
    sendTextMessage: vi.fn().mockResolvedValue({ externalMessageId: "m2" }),
    sendQuickReplies: vi.fn().mockResolvedValue({ externalMessageId: "m3" }),
    sendButtonTemplate: vi.fn().mockResolvedValue({ externalMessageId: "m4" }),
    ...overrides,
  };
}

describe("buildQuickReplyPayload / parseQuickReplyPayload", () => {
  it("faz round-trip sem perder nenhuma parte", () => {
    const payload = buildQuickReplyPayload("run-abc", "node-xyz", "yes");
    expect(payload).toBe("run-abc:node-xyz:yes");
    expect(parseQuickReplyPayload(payload)).toEqual({
      runId: "run-abc",
      nodeId: "node-xyz",
      optionKey: "yes",
    });
  });

  it("nunca depende do título do botão — só do payload que a gente definiu", () => {
    // Se alguém tentar "adivinhar" pelo título, não tem como: o payload é opaco.
    expect(parseQuickReplyPayload("Me manda o vídeo")).toBeNull();
  });

  it("retorna null pra payload malformado, sem lançar exceção", () => {
    expect(parseQuickReplyPayload("so-uma-parte")).toBeNull();
    expect(parseQuickReplyPayload("a:b:c:d")).toBeNull();
    expect(parseQuickReplyPayload("")).toBeNull();
  });
});

describe("advanceRun", () => {
  const linearGraph: Graph = {
    nodes: [
      { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
      { id: "kw", type: "KEYWORD_MATCH", data: { keywords: [{ value: "eu quero", matchType: "EXACT" }] } },
      { id: "pub", type: "PUBLIC_REPLY", data: { variants: ["Te mandei no direct!"] } },
      { id: "priv", type: "PRIVATE_REPLY", data: { text: "Oi! Aqui está o link." } },
      { id: "end", type: "END", data: {} },
    ],
    edges: [
      { from: "trigger", to: "kw" },
      { from: "kw", to: "pub" },
      { from: "pub", to: "priv" },
      { from: "priv", to: "end" },
    ],
  };

  function seedRun(fake: ReturnType<typeof createFakeSupabase>) {
    fake.__tables.automation_runs.push({
      id: "run1",
      workspace_id: "ws1",
      contact_id: "contact1",
      conversation_id: "conv1",
      status: "running",
      cursor_node_id: null,
      waiting_reason: null,
      context: {},
    });
  }

  it("percorre um flow linear até END, chamando a Meta API na ordem certa", async () => {
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph: linearGraph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: "comment-1",
      ctx: baseCtx(),
    });

    expect(meta.sendPublicReply).toHaveBeenCalledWith({
      accessToken: "token-1",
      commentId: "comment-1",
      text: "Te mandei no direct!",
    });
    expect(meta.sendPrivateReply).toHaveBeenCalledWith({
      accessToken: "token-1",
      igUserId: "ig-account-1",
      commentId: "comment-1",
      text: "Oi! Aqui está o link.",
    });
    expect(fake.__tables.automation_runs[0].status).toBe("completed");
    // 5 nodes = 5 steps logados (trigger, kw, pub, priv, end)
    expect(fake.__tables.automation_run_steps).toHaveLength(5);
  });

  // Achado real da auditoria de 24/09/2026: `messages` existia no schema
  // desde o início, mas nenhum código jamais escrevia nela — o Inbox não
  // teria dado nenhum de verdade pra mostrar. PUBLIC_REPLY não conta (não é
  // DM, fica só em automation_run_steps.output).
  it("grava PRIVATE_REPLY na tabela messages (direction=outbound, origin=automation)", async () => {
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph: linearGraph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: "comment-1",
      ctx: baseCtx(),
    });

    expect(fake.__tables.messages).toHaveLength(1);
    expect(fake.__tables.messages[0]).toMatchObject({
      workspace_id: "ws1",
      conversation_id: "conv1",
      direction: "outbound",
      origin: "automation",
      type: "text",
      text: "Oi! Aqui está o link.",
      status: "sent",
    });
  });

  it("grava SEND_MESSAGE com button na tabela messages com type=button", async () => {
    const graph: Graph = {
      nodes: [
        { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
        {
          id: "send",
          type: "SEND_MESSAGE",
          data: { text: "Tá na mão!", button: { title: "Assistir ao vídeo", url: "https://exemplo.com/v" } },
        },
      ],
      edges: [{ from: "trigger", to: "send" }],
    };
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: null,
      ctx: baseCtx(),
    });

    expect(fake.__tables.messages).toHaveLength(1);
    expect(fake.__tables.messages[0]).toMatchObject({ type: "button", text: "Tá na mão!", direction: "outbound" });
  });

  it("KEYWORD_MATCH sem bater termina o run sem mandar nenhuma mensagem", async () => {
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph: linearGraph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: "comment-1",
      ctx: baseCtx({ triggerText: "não tenho interesse" }),
    });

    expect(meta.sendPublicReply).not.toHaveBeenCalled();
    expect(meta.sendPrivateReply).not.toHaveBeenCalled();
    expect(fake.__tables.automation_runs[0].status).toBe("completed");
  });

  it("QUICK_REPLY pausa o run e embute runId:nodeId:optionKey no payload (nunca o título)", async () => {
    const graph: Graph = {
      nodes: [
        { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
        {
          id: "qr",
          type: "QUICK_REPLY",
          data: { text: "Quer o vídeo?", options: [{ key: "yes", title: "Me manda o vídeo" }] },
        },
        { id: "send", type: "SEND_MESSAGE", data: { text: "nunca deveria chegar aqui neste teste" } },
      ],
      edges: [
        { from: "trigger", to: "qr" },
        { from: "qr", to: "send" },
      ],
    };
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: null,
      ctx: baseCtx(),
    });

    expect(meta.sendQuickReplies).toHaveBeenCalledWith({
      accessToken: "token-1",
      igUserId: "ig-account-1",
      recipientId: "user-igsid-1",
      text: "Quer o vídeo?",
      options: [{ title: "Me manda o vídeo", payload: "run1:qr:yes" }],
    });
    expect(meta.sendTextMessage).not.toHaveBeenCalled(); // pausou, não deveria ter avançado pro SEND_MESSAGE
    const run = fake.__tables.automation_runs[0];
    expect(run.status).toBe("waiting");
    expect(run.waiting_reason).toBe("quick_reply");
    expect(run.cursor_node_id).toBe("qr");
  });

  it("PRIVATE_REPLY com quickReplyOptions anexa os botões NA MESMA mensagem e pausa o run, igual QUICK_REPLY", async () => {
    // Achado real 24/09/2026: duas mensagens separadas (PRIVATE_REPLY + QUICK_REPLY)
    // com o mesmo texto apareciam como bubbles duplicadas no Instagram — o fix é
    // anexar os botões na própria PRIVATE_REPLY. Ver comentário em lib/automation/engine.ts.
    const graph: Graph = {
      nodes: [
        { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
        {
          id: "priv",
          type: "PRIVATE_REPLY",
          data: {
            text: "Quer receber o vídeo?",
            quickReplyOptions: [{ key: "video", title: "Me manda o vídeo" }],
          },
        },
        { id: "send", type: "SEND_MESSAGE", data: { text: "nunca deveria chegar aqui neste teste" } },
      ],
      edges: [
        { from: "trigger", to: "priv" },
        { from: "priv", to: "send" },
      ],
    };
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: "comment-1",
      ctx: baseCtx(),
    });

    expect(meta.sendPrivateReply).toHaveBeenCalledWith({
      accessToken: "token-1",
      igUserId: "ig-account-1",
      commentId: "comment-1",
      text: "Quer receber o vídeo?",
      quickReplies: [{ title: "Me manda o vídeo", payload: "run1:priv:video" }],
    });
    expect(meta.sendTextMessage).not.toHaveBeenCalled(); // pausou, não deveria ter avançado pro SEND_MESSAGE
    const run = fake.__tables.automation_runs[0];
    expect(run.status).toBe("waiting");
    expect(run.waiting_reason).toBe("quick_reply");
    expect(run.cursor_node_id).toBe("priv");
    // type=quick_reply (não "text") porque o botão veio anexado nesta mensagem.
    expect(fake.__tables.messages[0]).toMatchObject({ type: "quick_reply", text: "Quer receber o vídeo?" });
  });

  it("PRIVATE_REPLY sem quickReplyOptions continua sem pausar (comportamento antigo, inalterado)", async () => {
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph: linearGraph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: "comment-1",
      ctx: baseCtx(),
    });

    expect(meta.sendPrivateReply).toHaveBeenCalledWith({
      accessToken: "token-1",
      igUserId: "ig-account-1",
      commentId: "comment-1",
      text: "Oi! Aqui está o link.",
    });
    expect(fake.__tables.automation_runs[0].status).toBe("completed"); // não pausou
  });

  it("SEND_MESSAGE com button manda Button Template em vez de texto simples", async () => {
    const graph: Graph = {
      nodes: [
        { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
        {
          id: "send",
          type: "SEND_MESSAGE",
          data: {
            text: "Tá na mão!",
            button: { title: "Assistir ao vídeo", url: "https://exemplo.com/video" },
          },
        },
      ],
      edges: [{ from: "trigger", to: "send" }],
    };
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: null,
      ctx: baseCtx(),
    });

    expect(meta.sendButtonTemplate).toHaveBeenCalledWith({
      accessToken: "token-1",
      igUserId: "ig-account-1",
      recipientId: "user-igsid-1",
      text: "Tá na mão!",
      buttons: [{ type: "web_url", title: "Assistir ao vídeo", url: "https://exemplo.com/video" }],
    });
    expect(meta.sendTextMessage).not.toHaveBeenCalled(); // URL nunca crua no texto
  });

  it("DELAY sem QStash configurado falha explicitamente (nunca finge que agendou)", async () => {
    const graph: Graph = {
      nodes: [
        { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
        { id: "delay", type: "DELAY", data: { minutes: 5 } },
      ],
      edges: [{ from: "trigger", to: "delay" }],
    };
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    // QSTASH_TOKEN não está setado no ambiente de teste -> scheduleAutomationResume
    // retorna ok:false de propósito, sem nenhum mock — é o comportamento real.
    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: null,
      ctx: baseCtx(),
    });

    expect(fake.__tables.automation_runs[0].status).toBe("failed");
    const lastStep = fake.__tables.automation_run_steps.at(-1);
    expect(lastStep?.status).toBe("failed");
  });

  describe("retry de erro RETRYABLE (P1, auditoria 24/09/2026)", () => {
    afterEach(() => vi.clearAllMocks());

    it("MetaApiError RETRYABLE pausa a run (waiting/retry) e agenda o MESMO node via QStash", async () => {
      vi.mocked(qstash.scheduleAutomationResume).mockResolvedValueOnce({ ok: true, messageId: "qstash-msg-1" });

      const graph: Graph = {
        nodes: [
          { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
          { id: "pub", type: "PUBLIC_REPLY", data: { variants: ["Te mandei no direct!"] } },
        ],
        edges: [{ from: "trigger", to: "pub" }],
      };
      const fake = createFakeSupabase();
      seedRun(fake);
      const rateLimited = new MetaApiError("rate limited", { kind: "RETRYABLE", code: 4, httpStatus: 400 });
      const meta = fakeMeta({ sendPublicReply: vi.fn().mockRejectedValue(rateLimited) });

      await advanceRun(fake as never, meta, {
        run: fake.__tables.automation_runs[0] as never,
        graph,
        socialAccount,
        recipientId: "user-igsid-1",
        commentId: "comment-1",
        ctx: baseCtx(),
      });

      expect(qstash.scheduleAutomationResume).toHaveBeenCalledWith({
        automationRunId: "run1",
        minutes: 1, // primeira tentativa de retry — ver lib/automation/retry-policy.ts
        deduplicationId: "retry:run1:pub:1",
      });
      const run = fake.__tables.automation_runs[0];
      expect(run.status).toBe("waiting");
      expect(run.waiting_reason).toBe("retry");
      expect(run.cursor_node_id).toBe("pub");
      const lastStep = fake.__tables.automation_run_steps.at(-1) as { status: string; attempt: number };
      expect(lastStep.status).toBe("failed");
      expect(lastStep.attempt).toBe(1);
    });

    it("depois de MAX_RETRY_ATTEMPTS falhas, desiste de vez — nunca retenta pra sempre", async () => {
      const graph: Graph = {
        nodes: [
          { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
          { id: "pub", type: "PUBLIC_REPLY", data: { variants: ["Te mandei no direct!"] } },
        ],
        edges: [{ from: "trigger", to: "pub" }],
      };
      const fake = createFakeSupabase();
      seedRun(fake);
      // Simula 3 tentativas já falhadas nesse mesmo node — a próxima (4ª)
      // deve esgotar MAX_RETRY_ATTEMPTS e falhar de vez.
      for (let attempt = 1; attempt <= 3; attempt++) {
        fake.__tables.automation_run_steps.push({
          automation_run_id: "run1",
          node_id: "pub",
          node_type: "PUBLIC_REPLY",
          status: "failed",
          attempt,
        });
      }
      const rateLimited = new MetaApiError("rate limited", { kind: "RETRYABLE", code: 4, httpStatus: 400 });
      const meta = fakeMeta({ sendPublicReply: vi.fn().mockRejectedValue(rateLimited) });

      await advanceRun(fake as never, meta, {
        run: fake.__tables.automation_runs[0] as never,
        graph,
        socialAccount,
        recipientId: "user-igsid-1",
        commentId: "comment-1",
        ctx: baseCtx(),
      });

      expect(qstash.scheduleAutomationResume).not.toHaveBeenCalled();
      const run = fake.__tables.automation_runs[0];
      expect(run.status).toBe("failed");
      expect(run.waiting_reason).toBeNull(); // nunca ficou 'waiting' — desistiu de vez
    });

    it("erro NON_RETRYABLE nunca tenta reagendar — falha de vez na primeira falha", async () => {
      const graph: Graph = {
        nodes: [
          { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
          { id: "pub", type: "PUBLIC_REPLY", data: { variants: ["Te mandei no direct!"] } },
        ],
        edges: [{ from: "trigger", to: "pub" }],
      };
      const fake = createFakeSupabase();
      seedRun(fake);
      const authError = new MetaApiError("token inválido", { kind: "NON_RETRYABLE", code: 190, httpStatus: 401 });
      const meta = fakeMeta({ sendPublicReply: vi.fn().mockRejectedValue(authError) });

      await advanceRun(fake as never, meta, {
        run: fake.__tables.automation_runs[0] as never,
        graph,
        socialAccount,
        recipientId: "user-igsid-1",
        commentId: "comment-1",
        ctx: baseCtx(),
      });

      expect(qstash.scheduleAutomationResume).not.toHaveBeenCalled();
      expect(fake.__tables.automation_runs[0].status).toBe("failed");
    });
  });

  it("HTTP_REQUEST bloqueia URL de rede privada e falha o run, sem chamar fetch de verdade", async () => {
    const graph: Graph = {
      nodes: [
        { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
        { id: "http", type: "HTTP_REQUEST", data: { url: "http://169.254.169.254/latest/meta-data", method: "GET" } },
      ],
      edges: [{ from: "trigger", to: "http" }],
    };
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: null,
      ctx: baseCtx(),
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(fake.__tables.automation_runs[0].status).toBe("failed");
    fetchSpy.mockRestore();
  });

  it("ADD_TAG grava a tag e ela fica disponível pro CONDITION seguinte (tag_exists)", async () => {
    const graph: Graph = {
      nodes: [
        { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
        { id: "tag", type: "ADD_TAG", data: { tagName: "lead_fleyn" } },
        { id: "cond", type: "CONDITION", data: { rule: { type: "tag_exists", tagName: "lead_fleyn" } } },
        { id: "send_true", type: "SEND_MESSAGE", data: { text: "tinha a tag" } },
        { id: "send_false", type: "SEND_MESSAGE", data: { text: "não tinha a tag" } },
      ],
      edges: [
        { from: "trigger", to: "tag" },
        { from: "tag", to: "cond" },
        { from: "cond", to: "send_true", label: "true" },
        { from: "cond", to: "send_false", label: "false" },
      ],
    };
    const fake = createFakeSupabase();
    seedRun(fake);
    const meta = fakeMeta();

    await advanceRun(fake as never, meta, {
      run: fake.__tables.automation_runs[0] as never,
      graph,
      socialAccount,
      recipientId: "user-igsid-1",
      commentId: null,
      ctx: baseCtx(),
    });

    expect(meta.sendTextMessage).toHaveBeenCalledWith(
      expect.objectContaining({ text: "tinha a tag" })
    );
  });
});
