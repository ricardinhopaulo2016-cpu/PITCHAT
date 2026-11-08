import { describe, expect, it } from "vitest";
import { delta, formatCount, formatDelta, formatRate, rate } from "@/lib/metrics/rates";

describe("rate", () => {
  it("denominador 0 ou null vira no_base", () => {
    expect(rate(5, 0)).toEqual({ kind: "no_base" });
    expect(rate(5, null)).toEqual({ kind: "no_base" });
    expect(rate(null, 5)).toEqual({ kind: "no_base" });
    expect(formatRate(rate(0, 0))).toBe("sem base");
  });

  it("0/10 é um 0% real", () => {
    expect(formatRate(rate(0, 10))).toBe("0%");
  });

  it("1/1000 vira <1%", () => {
    expect(formatRate(rate(1, 1000))).toBe("<1%");
  });

  it("arredonda a porcentagem", () => {
    expect(formatRate(rate(42, 100))).toBe("42%");
  });

  it("pendência é texto, não porcentagem", () => {
    expect(formatRate({ kind: "pending", pending: 12 })).toBe("12 pendentes");
    expect(formatRate({ kind: "pending", pending: 1 })).toBe("1 pendente");
  });
});

describe("delta", () => {
  it("base 0 ou null vira no_base", () => {
    expect(delta(5, 0)).toEqual({ kind: "no_base" });
    expect(delta(null, 5)).toEqual({ kind: "no_base" });
    expect(delta(5, null)).toEqual({ kind: "no_base" });
    expect(formatDelta(delta(5, 0))).toBe("sem base");
  });

  it("formata com sinal", () => {
    expect(formatDelta(delta(112, 100))).toBe("+12%");
    expect(formatDelta(delta(92, 100))).toBe("-8%");
    expect(formatDelta(delta(100, 100))).toBe("0%");
    expect(formatDelta(delta(1000, 1001))).toBe("0%");
  });
});

describe("formatCount", () => {
  it("null não vira 0", () => {
    expect(formatCount(null)).toBe("sem dado");
  });

  it("usa separador pt-BR e mantém o zero real", () => {
    expect(formatCount(1000)).toBe("1.000");
    expect(formatCount(0)).toBe("0");
  });
});
