import { describe, expect, it } from "vitest";
import { evaluateNode, evaluateCondition, type ExecutionContext } from "@/lib/automation/node-handlers";
import type { GraphNode } from "@/lib/automation/graph";

const baseCtx: ExecutionContext = {
  variables: {},
  triggerText: "",
  contactTags: [],
  customFields: {},
  conversationAutomationEnabled: true,
};

function node(type: GraphNode["type"], data: Record<string, unknown> = {}): GraphNode {
  return { id: "n1", type, data };
}

describe("evaluateNode", () => {
  it("KEYWORD_MATCH: continua quando a keyword bate", () => {
    const n = node("KEYWORD_MATCH", { keywords: [{ value: "eu quero", matchType: "EXACT" }] });
    const outcome = evaluateNode(n, { ...baseCtx, triggerText: "EU QUERO!!" });
    expect(outcome).toEqual({ kind: "continue" });
  });

  it("KEYWORD_MATCH: no_match quando nenhuma keyword bate", () => {
    const n = node("KEYWORD_MATCH", { keywords: [{ value: "eu quero", matchType: "EXACT" }] });
    const outcome = evaluateNode(n, { ...baseCtx, triggerText: "não tenho interesse" });
    expect(outcome).toEqual({ kind: "no_match" });
  });

  it("PUBLIC_REPLY: escolhe a variante certa via RNG injetado (determinístico)", () => {
    const n = node("PUBLIC_REPLY", { variants: ["A", "B", "C"] });
    expect(evaluateNode(n, baseCtx, () => 0)).toEqual({ kind: "public_reply", text: "A" });
    expect(evaluateNode(n, baseCtx, () => 0.99)).toEqual({ kind: "public_reply", text: "C" });
    expect(evaluateNode(n, baseCtx, () => 0.5)).toEqual({ kind: "public_reply", text: "B" });
  });

  it("PRIVATE_REPLY: repassa o texto configurado", () => {
    const n = node("PRIVATE_REPLY", { text: "Olha sua DM!" });
    expect(evaluateNode(n, baseCtx)).toEqual({ kind: "private_reply", text: "Olha sua DM!" });
  });

  it("QUICK_REPLY: repassa texto e opções", () => {
    const n = node("QUICK_REPLY", {
      text: "Quer o vídeo?",
      options: [{ key: "yes", title: "Me manda" }],
    });
    expect(evaluateNode(n, baseCtx)).toEqual({
      kind: "quick_reply",
      text: "Quer o vídeo?",
      options: [{ key: "yes", title: "Me manda" }],
    });
  });

  it("DELAY: repassa minutos", () => {
    expect(evaluateNode(node("DELAY", { minutes: 5 }), baseCtx)).toEqual({ kind: "delay", minutes: 5 });
  });

  it("CONDITION: vira branch 'true'/'false' conforme a regra", () => {
    const n = node("CONDITION", { rule: { type: "user_replied" } });
    expect(evaluateNode(n, { ...baseCtx, userRepliedSinceLastMessage: true })).toEqual({
      kind: "branch",
      label: "true",
    });
    expect(evaluateNode(n, { ...baseCtx, userRepliedSinceLastMessage: false })).toEqual({
      kind: "branch",
      label: "false",
    });
  });

  it("RANDOM_SPLIT: escolhe branch via RNG injetado", () => {
    const n = node("RANDOM_SPLIT", { branches: ["a", "b"] });
    expect(evaluateNode(n, baseCtx, () => 0)).toEqual({ kind: "branch", label: "a" });
    expect(evaluateNode(n, baseCtx, () => 0.9)).toEqual({ kind: "branch", label: "b" });
  });

  it("ADD_TAG / REMOVE_TAG / SET_CUSTOM_FIELD repassam os dados", () => {
    expect(evaluateNode(node("ADD_TAG", { tagName: "lead" }), baseCtx)).toEqual({
      kind: "add_tag",
      tagName: "lead",
    });
    expect(evaluateNode(node("REMOVE_TAG", { tagName: "lead" }), baseCtx)).toEqual({
      kind: "remove_tag",
      tagName: "lead",
    });
    expect(evaluateNode(node("SET_CUSTOM_FIELD", { key: "score", value: 10 }), baseCtx)).toEqual({
      kind: "set_custom_field",
      key: "score",
      value: 10,
    });
  });

  it("HTTP_REQUEST: repassa url/method/headers/body sem validar (SSRF é responsabilidade do orquestrador)", () => {
    const n = node("HTTP_REQUEST", { url: "https://x.com", method: "POST", body: { a: 1 } });
    expect(evaluateNode(n, baseCtx)).toEqual({
      kind: "http_request",
      url: "https://x.com",
      method: "POST",
      headers: undefined,
      body: { a: 1 },
    });
  });

  it("END: encerra", () => {
    expect(evaluateNode(node("END"), baseCtx)).toEqual({ kind: "end" });
  });

  it("TRIGGER_COMMENT: apenas continua (é o ponto de entrada)", () => {
    expect(evaluateNode(node("TRIGGER_COMMENT"), baseCtx)).toEqual({ kind: "continue" });
  });
});

describe("evaluateCondition", () => {
  it("quick_reply_clicked compara com a opção clicada de verdade", () => {
    const rule = { type: "quick_reply_clicked" as const, optionKey: "yes" };
    expect(evaluateCondition(rule, { ...baseCtx, quickReplyOptionKey: "yes" })).toBe(true);
    expect(evaluateCondition(rule, { ...baseCtx, quickReplyOptionKey: "no" })).toBe(false);
    expect(evaluateCondition(rule, baseCtx)).toBe(false);
  });

  it("tag_exists olha as tags reais do contato", () => {
    const rule = { type: "tag_exists" as const, tagName: "lead_fleyn" };
    expect(evaluateCondition(rule, { ...baseCtx, contactTags: ["lead_fleyn"] })).toBe(true);
    expect(evaluateCondition(rule, { ...baseCtx, contactTags: ["outra"] })).toBe(false);
  });

  it("nunca inventa um evento que a Meta não fornece — regra desconhecida é false", () => {
    expect(evaluateCondition({ type: "clicou_no_link" }, baseCtx)).toBe(false);
    expect(evaluateCondition(undefined, baseCtx)).toBe(false);
    expect(evaluateCondition(null, baseCtx)).toBe(false);
  });
});
