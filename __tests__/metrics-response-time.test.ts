import { describe, expect, it } from "vitest";
import { COMMENT_TIME_UNAVAILABLE, formatDuration, toDistribution } from "@/lib/metrics/response-time";

describe("toDistribution", () => {
  it("n=2 anula p50 e p95", () => {
    expect(toDistribution(2, 10, 20)).toEqual({ samples: 2, p50: null, p95: null });
  });

  it("n=3 mantém p50", () => {
    expect(toDistribution(3, 10, 20)).toEqual({ samples: 3, p50: 10, p95: null });
  });

  it("n=19 anula p95", () => {
    expect(toDistribution(19, 10, 20).p95).toBeNull();
  });

  it("n=20 mantém os dois", () => {
    expect(toDistribution(20, 10, 20)).toEqual({ samples: 20, p50: 10, p95: 20 });
  });

  it("samples null não gera percentil", () => {
    expect(toDistribution(null, 10, 20)).toEqual({ samples: 0, p50: null, p95: null });
  });
});

describe("formatDuration", () => {
  it.each([
    [45, "45s"],
    [200, "3min 20s"],
    [180, "3min"],
    [7500, "2h 5min"],
    [7200, "2h"],
    [59.6, "1min"],
    [0, "0s"],
  ])("%s segundos", (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });

  it("null vira sem base", () => {
    expect(formatDuration(null)).toBe("sem base");
  });
});

describe("COMMENT_TIME_UNAVAILABLE", () => {
  it("usa o texto definido", () => {
    expect(COMMENT_TIME_UNAVAILABLE).toBe("horário do comentário indisponível");
  });
});
