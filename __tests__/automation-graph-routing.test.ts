import { describe, expect, it } from "vitest";
import { nextNode, resumeTargetId, type Graph } from "@/lib/automation/graph";

const node = (id: string, type = "END") => ({ id, type: type as never, data: {} });

// Aresta SEM rótulo listada ANTES das rotuladas: antes capturava todo ramo.
const branching: Graph = {
  nodes: [node("c", "CONDITION"), node("fallback"), node("yes"), node("no")],
  edges: [
    { from: "c", to: "fallback" },
    { from: "c", to: "yes", label: "true" },
    { from: "c", to: "no", label: "false" },
  ],
};

describe("nextNode — rótulo exato vence aresta sem rótulo", () => {
  it("true e false seguem suas próprias arestas", () => {
    expect(nextNode(branching, "c", "true")?.id).toBe("yes");
    expect(nextNode(branching, "c", "false")?.id).toBe("no");
  });

  it("rótulo sem aresta própria cai na aresta sem rótulo", () => {
    expect(nextNode(branching, "c", "outro")?.id).toBe("fallback");
  });

  it("sem rótulo pedido, mantém a primeira aresta de saída", () => {
    expect(nextNode(branching, "c")?.id).toBe("fallback");
  });

  it("sem nenhuma aresta compatível devolve undefined", () => {
    const g: Graph = { nodes: [node("c"), node("x")], edges: [{ from: "c", to: "x", label: "a" }] };
    expect(nextNode(g, "c", "b")).toBeUndefined();
  });
});

describe("resumeTargetId — retomada de quick reply e delay", () => {
  const qr: Graph = {
    nodes: [node("q", "QUICK_REPLY"), node("a"), node("b"), node("any")],
    edges: [
      { from: "q", to: "a", label: "sim" },
      { from: "q", to: "b", label: "nao" },
      { from: "q", to: "any" },
    ],
  };

  it("segue a aresta da opção clicada", () => {
    expect(resumeTargetId(qr, "q", "q", "sim")).toBe("a");
    expect(resumeTargetId(qr, "q", "q", "nao")).toBe("b");
  });

  it("opção sem aresta própria usa a aresta sem rótulo", () => {
    expect(resumeTargetId(qr, "q", "q", "talvez")).toBe("any");
  });

  it("sem rótulo (delay) prefere a aresta sem rótulo", () => {
    expect(resumeTargetId(qr, "q", "q")).toBe("any");
  });

  it("grafo linear antigo continua funcionando", () => {
    const linear: Graph = { nodes: [node("q"), node("n")], edges: [{ from: "q", to: "n" }] };
    expect(resumeTargetId(linear, "q", "q", "qualquer")).toBe("n");
    expect(resumeTargetId(linear, "q", "q")).toBe("n");
  });

  it("sem aresta de saída devolve o fallback (comportamento antigo)", () => {
    expect(resumeTargetId({ nodes: [node("q")], edges: [] }, "q", "q", "x")).toBe("q");
  });
});
