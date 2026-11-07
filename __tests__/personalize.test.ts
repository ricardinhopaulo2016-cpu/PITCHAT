import { describe, expect, it, vi } from "vitest";
import { firstNameFrom, renderMessageText } from "@/lib/automation/personalize";
import { advanceRun } from "@/lib/automation/engine";
import type { MetaClient } from "@/lib/meta/client";
import type { Graph } from "@/lib/automation/graph";
import type { ExecutionContext } from "@/lib/automation/node-handlers";
import { createFakeSupabase } from "./fakes/fake-supabase";

vi.mock("@/lib/qstash", () => ({
  scheduleAutomationResume: vi.fn().mockResolvedValue({ ok: false, reason: "QSTASH_NOT_CONFIGURED" }),
}));

describe("firstNameFrom", () => {
  it("pega o primeiro nome e capitaliza", () => {
    expect(firstNameFrom("joão da silva")).toBe("João");
    expect(firstNameFrom("MARIA")).toBe("Maria");
    expect(firstNameFrom("  Ana   Paula ")).toBe("Ana");
  });
  it("devolve null quando não parece nome", () => {
    expect(firstNameFrom(null)).toBeNull();
    expect(firstNameFrom("")).toBeNull();
    expect(firstNameFrom("🔥🔥")).toBeNull();
    expect(firstNameFrom("123")).toBeNull();
    expect(firstNameFrom("x")).toBeNull();
    expect(firstNameFrom("Dr. Fulano")).toBeNull();
  });
});

describe("renderMessageText", () => {
  it("troca {nome} pelo primeiro nome", () => {
    expect(renderMessageText("Oi {nome}! Vi seu EU QUERO.", "João")).toBe("Oi João! Vi seu EU QUERO.");
  });
  it("sem nome, remove o token e o conector antes dele", () => {
    expect(renderMessageText("Oi {nome}! Vi seu EU QUERO.", null)).toBe("Oi! Vi seu EU QUERO.");
    expect(renderMessageText("Oi, {nome}! Vi seu EU QUERO.", null)).toBe("Oi! Vi seu EU QUERO.");
    expect(renderMessageText("{nome}, bora!", null)).toBe("Bora!");
  });
  it("não mexe em texto sem token", () => {
    expect(renderMessageText("Tá na mão!", "João")).toBe("Tá na mão!");
  });
});

const socialAccount = { id: "sa1", externalAccountId: "ig-account-1", accessToken: "token-1" };
const graph: Graph = {
  nodes: [
    { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
    { id: "msg", type: "SEND_MESSAGE", data: { text: "Oi {nome}! Aqui está a aula." } },
    { id: "end", type: "END", data: {} },
  ],
  edges: [
    { from: "trigger", to: "msg" },
    { from: "msg", to: "end" },
  ],
};
const ctx = (): ExecutionContext => ({
  variables: {},
  triggerText: "EU QUERO",
  contactTags: [],
  customFields: {},
  conversationAutomationEnabled: true,
});
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
function seed(contact: Record<string, unknown> = {}) {
  const fake = createFakeSupabase();
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
  fake.__tables.contacts.push({ id: "contact1", workspace_id: "ws1", display_name: null, ...contact });
  return fake;
}
async function run(fake: ReturnType<typeof createFakeSupabase>, meta: MetaClient) {
  await advanceRun(fake as never, meta, {
    run: fake.__tables.automation_runs[0] as never,
    graph,
    socialAccount,
    recipientId: "igsid-1",
    commentId: null,
    ctx: ctx(),
    startNodeId: "msg",
  });
}

describe("advanceRun com {nome}", () => {
  it("busca o nome na Meta na DM, grava em display_name e usa na mensagem", async () => {
    const fake = seed();
    const getUserProfile = vi.fn().mockResolvedValue({ name: "joana souza", username: "joana" });
    const meta = fakeMeta({ getUserProfile });
    await run(fake, meta);
    expect(getUserProfile).toHaveBeenCalledWith({ accessToken: "token-1", userId: "igsid-1" });
    expect(meta.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Oi Joana! Aqui está a aula." }));
    expect(fake.__tables.contacts[0].display_name).toBe("joana souza");
  });

  it("usa o nome já salvo sem chamar a Meta", async () => {
    const fake = seed({ display_name: "Pedro Alves" });
    const getUserProfile = vi.fn();
    const meta = fakeMeta({ getUserProfile });
    await run(fake, meta);
    expect(getUserProfile).not.toHaveBeenCalled();
    expect(meta.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Oi Pedro! Aqui está a aula." }));
  });

  it("se a Meta negar o perfil (sem consentimento), manda a versão sem nome e não quebra", async () => {
    const fake = seed();
    const getUserProfile = vi.fn().mockRejectedValue(new Error("User consent is required to access user profile"));
    const meta = fakeMeta({ getUserProfile });
    await run(fake, meta);
    expect(meta.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Oi! Aqui está a aula." }));
  });

  it("sem getUserProfile no cliente, também cai na versão sem nome", async () => {
    const fake = seed();
    const meta = fakeMeta();
    await run(fake, meta);
    expect(meta.sendTextMessage).toHaveBeenCalledWith(expect.objectContaining({ text: "Oi! Aqui está a aula." }));
  });
});
