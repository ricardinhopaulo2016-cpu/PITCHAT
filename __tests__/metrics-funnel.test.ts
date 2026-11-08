import { describe, expect, it } from "vitest";
import { buildFunnel, sumFunnel, type FunnelCounts } from "@/lib/metrics/funnel";
import { formatRate } from "@/lib/metrics/rates";

function counts(partial: Partial<FunnelCounts>): FunnelCounts {
  return { comments_valid: 0, requests_unique: 0, requests_without_author: 0, executions: 0, first_dm: 0, button: 0, link_button: 0, quick_reply_button: 0, ...partial };
}
const stage = (c: FunnelCounts, key: string) => buildFunnel(c).stages.find((s) => s.key === key)!;

describe("buildFunnel", () => {
  it("174 pedidos e 1 execução mostram a taxa real e a pendência", () => {
    const c = counts({ comments_valid: 200, requests_unique: 174, executions: 1 });
    expect(stage(c, "executions").rate).toEqual({ kind: "value", value: 1 / 174 });
    expect(formatRate(stage(c, "executions").rate!)).toBe("<1%");
    expect(buildFunnel(c).pendingExecution).toBe(173);
  });

  it("0 execuções com pedidos vira pendência, nunca 0%", () => {
    const c = counts({ comments_valid: 20, requests_unique: 12 });
    expect(stage(c, "executions").rate).toEqual({ kind: "pending", pending: 12 });
    expect(formatRate(stage(c, "executions").rate!)).toBe("12 pendentes");
  });

  it("execuções > 0 e DM 0 dá 0% real", () => {
    expect(formatRate(stage(counts({ requests_unique: 5, executions: 5 }), "first_dm").rate!)).toBe("0%");
  });

  it("DM 0 dá no_base em botão", () => {
    expect(stage(counts({ requests_unique: 5, executions: 5 }), "button").rate).toEqual({ kind: "no_base" });
  });

  it("sem comentários nem pedidos, tudo é no_base", () => {
    const funnel = buildFunnel(counts({}));
    expect(funnel.stages[0].rate).toBeNull();
    for (const s of funnel.stages.slice(1)) expect(s.rate).toEqual({ kind: "no_base" });
    expect(funnel.pendingExecution).toBe(0);
  });

  it("pedidos 0 com comentários: etapas seguintes são no_base", () => {
    const c = counts({ comments_valid: 30 });
    expect(formatRate(stage(c, "requests").rate!)).toBe("0%");
    for (const key of ["executions", "first_dm", "button"]) expect(stage(c, key).rate).toEqual({ kind: "no_base" });
  });

  it("usa os rótulos definidos", () => {
    const funnel = buildFunnel(counts({}));
    expect(funnel.stages.map((s) => s.label)).toEqual([
      "Comentários válidos",
      "Pedidos únicos",
      "Com execução iniciada",
      "Primeira DM enviada",
      "Mensagem com botão enviada",
    ]);
    expect(funnel.stages.map((s) => s.rateCaption)).toEqual([null, "dos comentários", "dos pedidos", "das execuções", "das primeiras DMs"]);
  });

  it("expõe subtotais de botão e pedidos sem autor", () => {
    const funnel = buildFunnel(counts({ link_button: 3, quick_reply_button: 2, requests_without_author: 4 }));
    expect(funnel.linkButton).toBe(3);
    expect(funnel.quickReplyButton).toBe(2);
    expect(funnel.requestsWithoutAuthor).toBe(4);
  });
});

describe("sumFunnel", () => {
  it("soma cada campo entre contas", () => {
    const a = counts({ comments_valid: 1, requests_unique: 2, requests_without_author: 3, executions: 4, first_dm: 5, button: 6, link_button: 7, quick_reply_button: 8 });
    expect(sumFunnel([a, a])).toEqual({ comments_valid: 2, requests_unique: 4, requests_without_author: 6, executions: 8, first_dm: 10, button: 12, link_button: 14, quick_reply_button: 16 });
  });

  it("lista vazia dá zeros", () => {
    expect(sumFunnel([])).toEqual(counts({}));
  });
});
