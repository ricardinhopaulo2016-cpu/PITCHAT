import { describe, expect, it } from "vitest";
import { computeGraphReviewHash, isReviewConfirmed } from "@/lib/automation/review-hash";
import type { Graph } from "@/lib/automation/graph";

const graphA: Graph = {
  nodes: [
    { id: "trigger", type: "TRIGGER_COMMENT", data: {} },
    { id: "end", type: "END", data: {} },
  ],
  edges: [{ from: "trigger", to: "end" }],
};

const graphB: Graph = {
  ...graphA,
  nodes: [...graphA.nodes, { id: "pub", type: "PUBLIC_REPLY", data: { variants: ["Oi!"] } }],
};

describe("computeGraphReviewHash", () => {
  it("é determinístico — o mesmo grafo sempre produz o mesmo hash", async () => {
    const h1 = await computeGraphReviewHash(graphA);
    const h2 = await computeGraphReviewHash(graphA);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
  });

  // Base do gate de revisão (B3): se o conteúdo mudar, o hash TEM que mudar
  // — senão a "revisão" de um texto poderia ser reaproveitada silenciosamente
  // pra publicar um texto diferente.
  it("grafos diferentes produzem hashes diferentes", async () => {
    const h1 = await computeGraphReviewHash(graphA);
    const h2 = await computeGraphReviewHash(graphB);
    expect(h1).not.toBe(h2);
  });
});

describe("isReviewConfirmed", () => {
  it("confirmado só quando confirmed=true E o hash bate exatamente", () => {
    expect(isReviewConfirmed({ confirmed: true, reviewedGraphHash: "abc" }, "abc")).toBe(true);
  });

  it("recusa se confirmed não for exatamente true (nunca truthy genérico)", () => {
    expect(isReviewConfirmed({ confirmed: "true", reviewedGraphHash: "abc" }, "abc")).toBe(false);
    expect(isReviewConfirmed({ confirmed: 1, reviewedGraphHash: "abc" }, "abc")).toBe(false);
  });

  it("recusa se o hash não bate — conteúdo mudou desde a revisão", () => {
    expect(isReviewConfirmed({ confirmed: true, reviewedGraphHash: "hash-antigo" }, "hash-novo")).toBe(false);
  });

  it("recusa se reviewedGraphHash não foi mandado", () => {
    expect(isReviewConfirmed({ confirmed: true }, "abc")).toBe(false);
  });

  it("recusa body vazio/malformado sem lançar exceção", () => {
    expect(isReviewConfirmed({}, "abc")).toBe(false);
  });
});
