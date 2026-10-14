import { describe, expect, it } from "vitest";
import {
  buildExampleFlow,
  compileFlowToGraph,
  EMPTY_FLOW,
} from "@/lib/automation/flow-spec";
import { summarizeIssues, validateGraph } from "@/lib/automation/validate-graph";
import type { Graph, GraphNode } from "@/lib/automation/graph";

const n = (id: string, type: GraphNode["type"], data: Record<string, unknown> = {}): GraphNode => ({
  id,
  type,
  data,
});

const codes = (g: unknown, stage: "draft" | "publish" = "publish") =>
  validateGraph(g, { stage }).errors.map((e) => e.code);
const warnCodes = (g: unknown, stage: "draft" | "publish" = "publish") =>
  validateGraph(g, { stage }).warnings.map((e) => e.code);

/** trigger → pub → end, válido. */
const base = (): Graph => ({
  nodes: [n("trigger", "TRIGGER_COMMENT"), n("pub", "PUBLIC_REPLY", { variants: ["Oi"] }), n("end", "END")],
  edges: [
    { from: "trigger", to: "pub" },
    { from: "pub", to: "end" },
  ],
});

describe("validateGraph — grafos reais do produto", () => {
  it("o fluxo de exemplo (seed) passa no estágio publish", () => {
    const v = validateGraph(compileFlowToGraph(buildExampleFlow()), { stage: "publish" });
    expect(v.errors).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("o rascunho vazio (trigger → end) pode ser salvo, mas não publicado", () => {
    const empty = compileFlowToGraph(EMPTY_FLOW);
    expect(validateGraph(empty, { stage: "draft" }).ok).toBe(true);
    expect(codes(empty, "publish")).toContain("NO_ACTION");
    expect(warnCodes(empty, "draft")).toContain("NO_ACTION");
  });

  it("o grafo mínimo válido não gera erros", () => {
    expect(validateGraph(base()).ok).toBe(true);
  });

  it("forma inválida (sem nodes/edges) é erro", () => {
    expect(codes(null)).toEqual(["INVALID_SHAPE"]);
    expect(codes({ nodes: [] })).toEqual(["INVALID_SHAPE"]);
  });
});

describe("validateGraph — estrutura", () => {
  it("exige exatamente um trigger e ao menos um END", () => {
    const noTrigger = { ...base(), nodes: base().nodes.filter((x) => x.id !== "trigger") };
    expect(codes(noTrigger)).toContain("NO_TRIGGER");

    const two = base();
    two.nodes.push(n("t2", "TRIGGER_COMMENT"));
    expect(codes(two)).toContain("MULTIPLE_TRIGGERS");

    const noEnd: Graph = { nodes: base().nodes.filter((x) => x.id !== "end"), edges: [{ from: "trigger", to: "pub" }] };
    expect(codes(noEnd)).toContain("NO_END");
  });

  it("ids duplicados e tipo desconhecido", () => {
    const g = base();
    g.nodes.push(n("pub", "END"));
    expect(codes(g)).toContain("DUPLICATE_NODE_ID");

    const h = base();
    h.nodes.push(n("x", "BANANA" as never));
    expect(codes(h)).toContain("UNKNOWN_NODE_TYPE");
  });

  it("aresta para nó inexistente", () => {
    const g = base();
    g.edges.push({ from: "pub", to: "fantasma" });
    expect(codes(g)).toContain("EDGE_UNKNOWN_NODE");
  });

  it("END com saída", () => {
    const g = base();
    g.edges.push({ from: "end", to: "pub" });
    expect(codes(g)).toContain("END_HAS_OUTGOING");
  });

  it("nó sem saída (beco): erro no publish, warning no draft", () => {
    const g = base();
    g.edges = [{ from: "trigger", to: "pub" }];
    expect(codes(g, "publish")).toContain("DEAD_END");
    expect(codes(g, "draft")).not.toContain("DEAD_END");
    expect(warnCodes(g, "draft")).toContain("DEAD_END");
  });

  it("nó inalcançável a partir do trigger", () => {
    const g = base();
    g.nodes.push(n("solto", "ADD_TAG", { tagName: "x" }));
    g.edges.push({ from: "solto", to: "end" });
    const issues = validateGraph(g).errors.filter((e) => e.code === "UNREACHABLE_NODE");
    expect(issues.map((i) => i.nodeId)).toEqual(["solto"]);
  });

  it("ciclo é erro", () => {
    const g: Graph = {
      nodes: [
        n("trigger", "TRIGGER_COMMENT"),
        n("a", "ADD_TAG", { tagName: "a" }),
        n("b", "ADD_TAG", { tagName: "b" }),
        n("end", "END"),
      ],
      edges: [
        { from: "trigger", to: "a" },
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    expect(codes(g)).toContain("CYCLE");
  });

  it("nó comum com duas saídas ou saída rotulada", () => {
    const two = base();
    two.edges.push({ from: "pub", to: "trigger", label: "x" });
    expect(codes(two)).toContain("INVALID_EDGE_LABEL");

    const dup: Graph = base();
    dup.nodes.push(n("b", "ADD_TAG", { tagName: "b" }));
    dup.edges.push({ from: "pub", to: "b" });
    dup.edges.push({ from: "b", to: "end" });
    expect(codes(dup)).toEqual(expect.arrayContaining(["DUPLICATE_EDGE_LABEL", "MULTIPLE_OUTGOING"]));
  });
});

describe("validateGraph — ramificação", () => {
  const condGraph = (edges: Graph["edges"]): Graph => ({
    nodes: [
      n("trigger", "TRIGGER_COMMENT"),
      n("c", "CONDITION", { rule: { type: "conversation_automation_enabled" } }),
      n("a", "ADD_TAG", { tagName: "a" }),
      n("b", "ADD_TAG", { tagName: "b" }),
      n("end", "END"),
    ],
    edges: [
      { from: "trigger", to: "c" },
      ...edges,
      { from: "a", to: "end" },
      { from: "b", to: "end" },
    ],
  });

  it("CONDITION completa (true e false) é válida", () => {
    const g = condGraph([
      { from: "c", to: "a", label: "true" },
      { from: "c", to: "b", label: "false" },
    ]);
    expect(validateGraph(g).ok).toBe(true);
  });

  it("CONDITION sem o ramo false", () => {
    const g = condGraph([{ from: "c", to: "a", label: "true" }]);
    g.nodes = g.nodes.filter((x) => x.id !== "b");
    g.edges = g.edges.filter((e) => e.from !== "b");
    expect(codes(g)).toContain("MISSING_BRANCH_EDGE");
  });

  it("aresta sem rótulo funciona como curinga do ramo que falta", () => {
    const g = condGraph([
      { from: "c", to: "a", label: "true" },
      { from: "c", to: "b" },
    ]);
    expect(validateGraph(g).ok).toBe(true);
  });

  it("rótulo que o nó não produz", () => {
    const g = condGraph([
      { from: "c", to: "a", label: "true" },
      { from: "c", to: "b", label: "talvez" },
    ]);
    expect(codes(g)).toEqual(expect.arrayContaining(["INVALID_EDGE_LABEL", "MISSING_BRANCH_EDGE"]));
  });

  it("RANDOM_SPLIT: um ramo por rótulo, ao menos 2 e únicos", () => {
    const g: Graph = {
      nodes: [
        n("trigger", "TRIGGER_COMMENT"),
        n("r", "RANDOM_SPLIT", { branches: ["A", "B"] }),
        n("a", "ADD_TAG", { tagName: "a" }),
        n("b", "ADD_TAG", { tagName: "b" }),
        n("end", "END"),
      ],
      edges: [
        { from: "trigger", to: "r" },
        { from: "r", to: "a", label: "A" },
        { from: "r", to: "b", label: "B" },
        { from: "a", to: "end" },
        { from: "b", to: "end" },
      ],
    };
    expect(validateGraph(g).ok).toBe(true);

    const incompleto = JSON.parse(JSON.stringify(g)) as Graph;
    incompleto.edges = incompleto.edges.filter((e) => e.label !== "B");
    incompleto.nodes = incompleto.nodes.filter((x) => x.id !== "b");
    incompleto.edges = incompleto.edges.filter((e) => e.from !== "b");
    expect(codes(incompleto)).toContain("MISSING_BRANCH_EDGE");

    const um = JSON.parse(JSON.stringify(g)) as Graph;
    um.nodes[1].data = { branches: ["A"] };
    expect(codes(um)).toContain("INVALID_NODE_DATA");

    const repetido = JSON.parse(JSON.stringify(g)) as Graph;
    repetido.nodes[1].data = { branches: ["A", "A"] };
    expect(codes(repetido)).toContain("INVALID_NODE_DATA");
  });

  it("QUICK_REPLY: arestas por opção (rótulo = chave) são aceitas", () => {
    const g: Graph = {
      nodes: [
        n("trigger", "TRIGGER_COMMENT"),
        n("q", "QUICK_REPLY", {
          text: "Quer?",
          options: [
            { key: "sim", title: "Sim" },
            { key: "nao", title: "Não" },
          ],
        }),
        n("a", "SEND_MESSAGE", { text: "Show" }),
        n("b", "SEND_MESSAGE", { text: "Beleza" }),
        n("end", "END"),
      ],
      edges: [
        { from: "trigger", to: "q" },
        { from: "q", to: "a", label: "sim" },
        { from: "q", to: "b", label: "nao" },
        { from: "a", to: "end" },
        { from: "b", to: "end" },
      ],
    };
    expect(validateGraph(g).ok).toBe(true);

    const errado = JSON.parse(JSON.stringify(g)) as Graph;
    errado.edges[1].label = "outra";
    expect(codes(errado)).toContain("INVALID_EDGE_LABEL");
  });
});

describe("validateGraph — dados dos nós", () => {
  const withNode = (node: GraphNode): Graph => ({
    nodes: [n("trigger", "TRIGGER_COMMENT"), node, n("end", "END")],
    edges: [
      { from: "trigger", to: node.id },
      { from: node.id, to: "end" },
    ],
  });

  it("textos vazios e listas vazias", () => {
    expect(codes(withNode(n("x", "PUBLIC_REPLY", { variants: [] })))).toContain("INVALID_NODE_DATA");
    expect(codes(withNode(n("x", "PRIVATE_REPLY", { text: "  " })))).toContain("INVALID_NODE_DATA");
    expect(codes(withNode(n("x", "SEND_MESSAGE", {})))).toContain("INVALID_NODE_DATA");
    expect(codes(withNode(n("x", "KEYWORD_MATCH", { keywords: [] })))).toContain("INVALID_NODE_DATA");
    expect(codes(withNode(n("x", "ADD_TAG", { tagName: "" })))).toContain("INVALID_NODE_DATA");
  });

  it("QUICK_REPLY: título até 20, máximo 13 opções, chaves únicas", () => {
    const opt = (key: string, title = "ok") => ({ key, title });
    expect(codes(withNode(n("x", "QUICK_REPLY", { text: "t", options: [opt("a", "x".repeat(21))] })))).toContain(
      "INVALID_NODE_DATA"
    );
    const muitas = Array.from({ length: 14 }, (_, i) => opt(`k${i}`));
    expect(codes(withNode(n("x", "QUICK_REPLY", { text: "t", options: muitas })))).toContain("INVALID_NODE_DATA");
    expect(codes(withNode(n("x", "QUICK_REPLY", { text: "t", options: [opt("a"), opt("a")] })))).toContain(
      "INVALID_NODE_DATA"
    );
  });

  it("SEND_MESSAGE com botão exige URL http(s) válida", () => {
    const ok = withNode(n("x", "SEND_MESSAGE", { text: "t", button: { title: "Abrir", url: "https://a.com/x" } }));
    expect(validateGraph(ok).ok).toBe(true);
    const ruim = withNode(n("x", "SEND_MESSAGE", { text: "t", button: { title: "Abrir", url: "javascript:1" } }));
    expect(codes(ruim)).toContain("INVALID_NODE_DATA");
  });

  it("DELAY: inteiro positivo; acima de 24h só avisa", () => {
    expect(codes(withNode(n("x", "DELAY", { minutes: 0 })))).toContain("INVALID_NODE_DATA");
    expect(codes(withNode(n("x", "DELAY", { minutes: 1.5 })))).toContain("INVALID_NODE_DATA");
    const longo = withNode(n("x", "DELAY", { minutes: 24 * 60 + 1 }));
    expect(codes(longo)).not.toContain("DELAY_OVER_24H");
    expect(warnCodes(longo)).toContain("DELAY_OVER_24H");
  });

  it("HTTP_REQUEST: URL passa pelo guard de SSRF e método é validado", () => {
    expect(codes(withNode(n("x", "HTTP_REQUEST", { url: "http://localhost:3000/x" })))).toContain("HTTP_URL_BLOCKED");
    expect(codes(withNode(n("x", "HTTP_REQUEST", { url: "http://169.254.169.254/" })))).toContain("HTTP_URL_BLOCKED");
    expect(codes(withNode(n("x", "HTTP_REQUEST", {})))).toContain("INVALID_NODE_DATA");
    expect(codes(withNode(n("x", "HTTP_REQUEST", { url: "https://api.exemplo.com", method: "TRACE" })))).toContain(
      "INVALID_NODE_DATA"
    );
    expect(validateGraph(withNode(n("x", "HTTP_REQUEST", { url: "https://api.exemplo.com/h", method: "post" }))).ok).toBe(true);
  });

  it("CONDITION: regra inválida é erro; regras não alimentadas só avisam", () => {
    const cond = (rule: unknown): Graph => ({
      nodes: [
        n("trigger", "TRIGGER_COMMENT"),
        n("c", "CONDITION", { rule }),
        n("a", "ADD_TAG", { tagName: "a" }),
        n("end", "END"),
      ],
      edges: [
        { from: "trigger", to: "c" },
        { from: "c", to: "a", label: "true" },
        { from: "c", to: "end", label: "false" },
        { from: "a", to: "end" },
      ],
    });
    expect(codes(cond({ type: "nao_existe" }))).toContain("INVALID_NODE_DATA");
    expect(codes(cond({ type: "tag_exists", tagName: "" }))).toContain("INVALID_NODE_DATA");
    const aviso = cond({ type: "user_replied" });
    expect(validateGraph(aviso).ok).toBe(true);
    expect(warnCodes(aviso)).toContain("CONDITION_RULE_UNRELIABLE");
    expect(warnCodes(cond({ type: "variable", key: "k", equals: 1 }))).not.toContain("CONDITION_RULE_UNRELIABLE");
  });

  it("SET_CUSTOM_FIELD avisa que não persiste", () => {
    const g = withNode(n("x", "SET_CUSTOM_FIELD", { key: "k", value: 1 }));
    expect(validateGraph(g).ok).toBe(true);
    expect(warnCodes(g)).toContain("SET_CUSTOM_FIELD_NOT_PERSISTED");
  });
});

describe("validateGraph — semântica", () => {
  it("PUBLIC/PRIVATE_REPLY depois de um QUICK_REPLY falham na retomada", () => {
    const g: Graph = {
      nodes: [
        n("trigger", "TRIGGER_COMMENT"),
        n("q", "QUICK_REPLY", { text: "Quer?", options: [{ key: "sim", title: "Sim" }] }),
        n("late", "PUBLIC_REPLY", { variants: ["oi"] }),
        n("end", "END"),
      ],
      edges: [
        { from: "trigger", to: "q" },
        { from: "q", to: "late" },
        { from: "late", to: "end" },
      ],
    };
    const e = validateGraph(g).errors.find((x) => x.code === "REPLY_AFTER_QUICK_REPLY");
    expect(e?.nodeId).toBe("late");
  });

  it("resposta pública ANTES do quick reply continua válida", () => {
    expect(validateGraph(compileFlowToGraph(buildExampleFlow())).errors).toEqual([]);
  });

  it("sem KEYWORD_MATCH avisa que dispara em todo comentário", () => {
    expect(warnCodes(base())).toContain("NO_KEYWORD_MATCH");
    expect(warnCodes(compileFlowToGraph(buildExampleFlow()))).not.toContain("NO_KEYWORD_MATCH");
  });

  it("summarizeIssues resume os primeiros erros", () => {
    const v = validateGraph({ nodes: [], edges: [] });
    expect(summarizeIssues(v)).toMatch(/gatilho/);
  });
});
