import { describe, expect, it } from "vitest";
import {
  buildExampleFlow,
  compileFlowToGraph,
  decompileGraphToFlow,
  validateFlowSpec,
  type FlowSpec,
} from "@/lib/automation/flow-spec";
import { findNode, nextNode } from "@/lib/automation/graph";
import { evaluateNode, type ExecutionContext } from "@/lib/automation/node-handlers";

const baseCtx: ExecutionContext = {
  variables: {},
  contactTags: [],
  customFields: {},
  conversationAutomationEnabled: true,
};

describe("compileFlowToGraph", () => {
  it("gera trigger -> steps -> end para um flow linear simples", () => {
    const spec: FlowSpec = {
      steps: [
        { type: "KEYWORD_MATCH", keywords: [{ value: "eu quero", matchType: "CONTAINS" }] },
        { type: "PUBLIC_REPLY", variants: ["ok"] },
      ],
    };
    const graph = compileFlowToGraph(spec);

    expect(graph.nodes.map((n) => n.type)).toEqual(["TRIGGER_COMMENT", "KEYWORD_MATCH", "PUBLIC_REPLY", "END"]);
    expect(nextNode(graph, "trigger")?.id).toBe("step-0");
    expect(nextNode(graph, "step-0")?.id).toBe("step-1");
    expect(nextNode(graph, "step-1")?.id).toBe("end");
  });

  it("CONDITION gera duas saídas: true continua a lista, false vai direto pro end", () => {
    const spec: FlowSpec = {
      steps: [
        { type: "CONDITION", rule: { type: "conversation_automation_enabled" } },
        { type: "SEND_MESSAGE", text: "follow-up" },
      ],
    };
    const graph = compileFlowToGraph(spec);

    expect(nextNode(graph, "step-0", "true")?.id).toBe("step-1");
    expect(nextNode(graph, "step-0", "false")?.id).toBe("end");
    expect(nextNode(graph, "step-1")?.id).toBe("end");
  });

  it("flow vazio ainda gera trigger -> end", () => {
    const graph = compileFlowToGraph({ steps: [] });
    expect(graph.nodes.map((n) => n.type)).toEqual(["TRIGGER_COMMENT", "END"]);
    expect(nextNode(graph, "trigger")?.id).toBe("end");
  });

  it("CONDITION como último step ainda fecha os dois braços no end", () => {
    const spec: FlowSpec = { steps: [{ type: "CONDITION", rule: { type: "user_replied" } }] };
    const graph = compileFlowToGraph(spec);
    expect(nextNode(graph, "step-0", "true")?.id).toBe("end");
    expect(nextNode(graph, "step-0", "false")?.id).toBe("end");
  });

  it("nodes compilados executam de verdade no engine (evaluateNode)", () => {
    const graph = compileFlowToGraph({
      steps: [{ type: "DELAY", minutes: 5 }, { type: "ADD_TAG", tagName: "lead" }],
    });
    const delayNode = findNode(graph, "step-0")!;
    expect(evaluateNode(delayNode, baseCtx)).toEqual({ kind: "delay", minutes: 5 });
    const tagNode = findNode(graph, "step-1")!;
    expect(evaluateNode(tagNode, baseCtx)).toEqual({ kind: "add_tag", tagName: "lead" });
  });
});

describe("decompileGraphToFlow", () => {
  it("é o inverso exato de compileFlowToGraph pro flow de exemplo", () => {
    const spec = buildExampleFlow();
    const graph = compileFlowToGraph(spec);
    expect(decompileGraphToFlow(graph)).toEqual(spec);
  });

  it("retorna null se não houver TRIGGER_COMMENT", () => {
    expect(decompileGraphToFlow({ nodes: [{ id: "x", type: "END", data: {} }], edges: [] })).toBeNull();
  });

  it("retorna null pra um node type não suportado pelo editor sequencial (ex: RANDOM_SPLIT)", () => {
    const graph = {
      nodes: [
        { id: "trigger", type: "TRIGGER_COMMENT" as const, data: {} },
        { id: "split", type: "RANDOM_SPLIT" as const, data: { branches: ["a", "b"] } },
      ],
      edges: [{ from: "trigger", to: "split" }],
    };
    expect(decompileGraphToFlow(graph)).toBeNull();
  });
});

describe("validateFlowSpec", () => {
  it("aceita um flow válido", () => {
    const result = validateFlowSpec(buildExampleFlow());
    expect(result.ok).toBe(true);
  });

  it("rejeita quick reply com mais de 13 opções (limite oficial do Send API)", () => {
    const spec = {
      steps: [
        {
          type: "QUICK_REPLY",
          text: "?",
          options: Array.from({ length: 14 }, (_, i) => ({ key: `k${i}`, title: `t${i}` })),
        },
      ],
    };
    const result = validateFlowSpec(spec);
    expect(result.ok).toBe(false);
  });

  it("rejeita step com type desconhecido", () => {
    const result = validateFlowSpec({ steps: [{ type: "NOT_A_TYPE" }] });
    expect(result.ok).toBe(false);
  });
});

describe("buildExampleFlow", () => {
  it("não referencia nenhum nome de perfil hardcoded", () => {
    const json = JSON.stringify(buildExampleFlow());
    expect(json.toLowerCase()).not.toContain("papagaio");
    expect(json.toLowerCase()).not.toContain("dodo");
  });
});
