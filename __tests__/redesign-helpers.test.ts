import { describe, expect, it } from "vitest";
import { accountIdentity } from "@/lib/ui/account-identity";
import { contactSearchPattern } from "@/lib/contacts/repo";
import { monthGrid, parseRange, rangePresets, rangeToIso, shiftMonth, formatRange } from "@/lib/ui/date-range";
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

describe("contactSearchPattern", () => {
  it("tira o @ e busca em qualquer parte do username", () => {
    expect(contactSearchPattern("  @maria ")).toBe("%maria%");
  });
  it("trata underline e porcentagem como texto, não curinga", () => {
    expect(contactSearchPattern("a_b%")).toBe("%a\\_b\\%%");
  });
  it("busca vazia não filtra", () => {
    expect(contactSearchPattern("   ")).toBeNull();
    expect(contactSearchPattern("@")).toBeNull();
  });
});

describe("período do calendário", () => {
  it("corrige ordem invertida e ignora lixo da URL", () => {
    expect(parseRange("2026-11-10", "2026-11-01")).toEqual({ from: "2026-11-01", to: "2026-11-10" });
    expect(parseRange("abc", "2026-02-31")).toBeNull();
    expect(parseRange("2026-11-05", null)).toEqual({ from: "2026-11-05", to: "2026-11-05" });
  });
  it("usa o dia de Brasília e inclui o último dia inteiro", () => {
    expect(rangeToIso({ from: "2026-11-01", to: "2026-11-01" })).toEqual({ start: "2026-11-01T03:00:00.000Z", end: "2026-11-02T03:00:00.000Z" });
  });
  it("o mês passado atravessa a virada do ano", () => {
    const preset = rangePresets("2026-01-15").find((p) => p.label === "Mês passado");
    expect(preset?.range).toEqual({ from: "2025-12-01", to: "2025-12-31" });
  });
  it("a grade do mês começa na segunda e cobre o mês inteiro", () => {
    const weeks = monthGrid("2026-11");
    expect(weeks[0][0]).toBe("2026-10-26");
    expect(weeks.flat()).toContain("2026-11-30");
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });
  it("shiftMonth e formatRange", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(formatRange({ from: "2026-11-01", to: "2026-11-30" })).toBe("01/11 a 30/11/2026");
    expect(formatRange({ from: "2026-11-01", to: "2026-11-01" })).toBe("01/11/2026");
  });
});
