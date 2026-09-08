import { describe, expect, it } from "vitest";
import { matchKeyword, normalizeText } from "@/lib/automation/normalize";

describe("normalizeText", () => {
  it("lowercases and trims", () => {
    expect(normalizeText("  EU QUERO!!  ")).toBe("eu quero");
  });

  it("collapses repeated whitespace", () => {
    expect(normalizeText("eu   quero\n\no link")).toBe("eu quero o link");
  });

  it("strips accents", () => {
    expect(normalizeText("já é meu, né?")).toBe("ja e meu ne");
  });

  it("strips punctuation without merging words", () => {
    expect(normalizeText("manda o link, por favor!")).toBe("manda o link por favor");
  });

  it("is idempotent", () => {
    const once = normalizeText("EU QUERO!!");
    expect(normalizeText(once)).toBe(once);
  });
});

describe("matchKeyword", () => {
  it("matches EXACT only on full equality after normalization", () => {
    const keywords = [{ value: "eu quero", matchType: "EXACT" as const }];
    expect(matchKeyword("EU QUERO!!!", keywords)?.value).toBe("eu quero");
    expect(matchKeyword("eu quero muito", keywords)).toBeNull();
  });

  it("matches CONTAINS as substring after normalization", () => {
    const keywords = [{ value: "quero o link", matchType: "CONTAINS" as const }];
    expect(matchKeyword("nossa, quero o link agora mesmo!", keywords)?.value).toBe(
      "quero o link"
    );
    expect(matchKeyword("quero o video", keywords)).toBeNull();
  });

  it("returns the first matching keyword, respecting list order", () => {
    const keywords = [
      { value: "eu quero", matchType: "EXACT" as const },
      { value: "quero", matchType: "CONTAINS" as const },
    ];
    expect(matchKeyword("eu quero", keywords)?.value).toBe("eu quero");
  });

  it("never matches an empty keyword", () => {
    const keywords = [{ value: "   ", matchType: "CONTAINS" as const }];
    expect(matchKeyword("qualquer coisa", keywords)).toBeNull();
  });

  it("returns null when nothing matches", () => {
    const keywords = [{ value: "eu quero", matchType: "EXACT" as const }];
    expect(matchKeyword("nao tenho interesse", keywords)).toBeNull();
  });
});
