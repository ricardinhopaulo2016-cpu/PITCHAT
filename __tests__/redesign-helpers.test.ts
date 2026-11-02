import { describe, expect, it } from "vitest";
import { accountIdentity } from "@/lib/ui/account-identity";
import { summarizeFlow } from "@/lib/automation/flow-summary";
import type { Graph } from "@/lib/automation/graph";
import { isDayKey, shiftWeek, weekOf } from "@/app/dashboard/publishing/format";

describe("accountIdentity", () => {
  it("deriva a sigla do username, ignorando símbolos", () => {
    expect(accountIdentity("_conta_teste").initials).toBe("Co");
  });
  it("é estável para o mesmo username", () => {
    expect(accountIdentity("conta_a").color).toBe(accountIdentity("conta_a").color);
  });
  it("não quebra sem username", () => {
    expect(accountIdentity(null).initials).toBe("?");
  });
});

describe("weekOf", () => {
  it("vai de segunda a domingo quando a referência é meio de semana", () => {
    const week = weekOf("2026-11-04");
    expect(week.map((d) => d.key)).toEqual(["2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"]);
  });
  it("domingo pertence à semana que começou na segunda anterior", () => {
    expect(weekOf("2026-11-08")[0].key).toBe("2026-11-02");
  });
  it("atravessa a virada do mês", () => {
    expect(weekOf("2026-11-01").map((d) => d.day)).toEqual(["26", "27", "28", "29", "30", "31", "01"]);
  });
  it("shiftWeek anda 7 dias", () => {
    expect(shiftWeek("2026-11-02", 1)).toBe("2026-11-09");
    expect(shiftWeek("2026-11-02", -1)).toBe("2026-10-26");
  });
  it("isDayKey recusa valor de URL inválido", () => {
    expect(isDayKey("2026-11-02")).toBe(true);
    expect(isDayKey("abc")).toBe(false);
    expect(isDayKey(undefined)).toBe(false);
  });
});

describe("summarizeFlow", () => {
  it("segue o caminho principal e esconde os passos de bastidor", () => {
    const graph: Graph = {
      nodes: [
        { id: "t", type: "TRIGGER_COMMENT", data: {} },
        { id: "k", type: "KEYWORD_MATCH", data: { keywords: [{ value: "EU QUERO", matchType: "CONTAINS" }] } },
        { id: "tag", type: "ADD_TAG", data: {} },
        { id: "d", type: "DELAY", data: { minutes: 2 } },
        { id: "e", type: "END", data: {} },
      ],
      edges: [
        { from: "t", to: "k" },
        { from: "k", to: "tag" },
        { from: "tag", to: "d" },
        { from: "d", to: "e" },
      ],
    };
    expect(summarizeFlow(graph).map((s) => [s.title, s.detail])).toEqual([
      ["Comentário no post", undefined],
      ["Palavra-chave", "EU QUERO"],
      ["Espera", "2 min"],
    ]);
  });
  it("não entra em loop em grafo com ciclo", () => {
    const graph: Graph = {
      nodes: [
        { id: "a", type: "TRIGGER_COMMENT", data: {} },
        { id: "b", type: "DELAY", data: { minutes: 1 } },
      ],
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "a" },
      ],
    };
    expect(summarizeFlow(graph)).toHaveLength(2);
  });
  it("devolve vazio sem grafo", () => {
    expect(summarizeFlow(null)).toEqual([]);
  });
});
