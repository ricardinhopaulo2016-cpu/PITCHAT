import { describe, expect, it, vi } from "vitest";
import { advanceRun, buildQuickReplyPayload, parseQuickReplyPayload } from "@/lib/automation/engine";
import type { MetaClient } from "@/lib/meta/client";
import type { Graph } from "@/lib/automation/graph";
import type { ExecutionContext } from "@/lib/automation/node-handlers";
import { createFakeSupabase } from "./fakes/fake-supabase";

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
