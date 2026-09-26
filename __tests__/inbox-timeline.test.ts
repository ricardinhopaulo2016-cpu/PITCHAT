import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "./fakes/fake-supabase";
import { composeTimeline, loadConversationTimeline, type RunStepRow } from "@/lib/inbox/repo";

/**
 * Composição da timeline operacional (Fase C de produto): comentários +
 * mensagens + sinais compactos do engine. O risco real aqui é duplicar
 * informação (SEND_MESSAGE já existe em `messages`) ou esconder falha.
 */

const step = (over: Partial<RunStepRow> & Pick<RunStepRow, "id" | "node_type" | "started_at">): RunStepRow => ({
  automation_run_id: "run-1",
  status: "succeeded",
  input: null,
  output: null,
  error: null,
  attempt: 1,
  ...over,
});

const comment = { id: "c1", text: "piada de papagaio", created_at: "2026-09-26T19:03:00.000Z", external_media_id: "111" };
const msg = (over: Record<string, unknown>) => ({
  id: "m",
  text: "oi",
  direction: "outbound",
  origin: "automation",
  type: "text",
  payload: {},
  created_at: "2026-09-26T19:03:05.000Z",
  sent_at: null,
  received_at: null,
  ...over,
});

describe("composeTimeline — sinais de engine", () => {
  it("nunca duplica SEND_MESSAGE / PRIVATE_REPLY / QUICK_REPLY (já existem em messages) nem mostra tags/trigger", () => {
    const timeline = composeTimeline({
      comments: [comment],
      messages: [msg({ id: "m1", text: "Te mandei!", created_at: "2026-09-26T19:03:04.000Z" })],
      steps: [
        step({ id: "s0", node_type: "TRIGGER_COMMENT", started_at: "2026-09-26T19:03:00.500Z" }),
        step({ id: "s1", node_type: "KEYWORD_MATCH", input: "piada de papagaio", started_at: "2026-09-26T19:03:01.000Z" }),
        step({ id: "s2", node_type: "PUBLIC_REPLY", output: { text: "🦜 Te mandei no direct!" }, started_at: "2026-09-26T19:03:02.000Z" }),
        step({ id: "s3", node_type: "PRIVATE_REPLY", started_at: "2026-09-26T19:03:03.000Z" }),
        step({ id: "s4", node_type: "SEND_MESSAGE", started_at: "2026-09-26T19:03:03.500Z" }),
        step({ id: "s5", node_type: "QUICK_REPLY", started_at: "2026-09-26T19:03:03.700Z" }),
        step({ id: "s6", node_type: "ADD_TAG", output: { tagName: "lead" }, started_at: "2026-09-26T19:03:03.800Z" }),
      ],
    });

    const ids = timeline.map((e) => e.id);
    expect(ids).not.toContain("step-s0");
    expect(ids).not.toContain("step-s3");
    expect(ids).not.toContain("step-s4");
    expect(ids).not.toContain("step-s5");
    expect(ids).not.toContain("step-s6");
    // comentário + keyword + public reply + 1 mensagem — nada além disso
    expect(ids).toEqual(["comment-c1", "step-s1", "step-s2", "msg-m1"]);
  });

  it("KEYWORD_MATCH aparece uma única vez, com a frase que casou", () => {
    const timeline = composeTimeline({
      comments: [comment],
      messages: [],
      steps: [step({ id: "k", node_type: "KEYWORD_MATCH", input: "piada de papagaio", started_at: "2026-09-26T19:03:01.000Z" })],
    });
    const keywords = timeline.filter((e) => e.signal?.label === "Keyword match");
    expect(keywords).toHaveLength(1);
    expect(keywords[0].signal?.marker).toBe("logic");
    expect(keywords[0].signal?.detail).toBe("“piada de papagaio”");
  });

  it("KEYWORD_MATCH sem correspondência vira sinal próprio, não 'match'", () => {
    const timeline = composeTimeline({
      comments: [],
      messages: [],
      steps: [step({ id: "k", node_type: "KEYWORD_MATCH", output: { matched: false }, started_at: "2026-09-26T19:03:01.000Z" })],
    });
    expect(timeline[0].signal?.label).toBe("Sem correspondência de keyword");
  });

  it("ordena cronologicamente mesmo com fontes fora de ordem, e DELAY fica entre a mensagem antes e a depois", () => {
    const timeline = composeTimeline({
      comments: [comment],
      messages: [
        msg({ id: "late", text: "follow-up", created_at: "2026-09-26T19:05:10.000Z" }),
        msg({ id: "early", text: "Te mandei!", created_at: "2026-09-26T19:03:04.000Z" }),
      ],
      steps: [
        step({ id: "end", node_type: "END", started_at: "2026-09-26T19:05:11.000Z" }),
        step({ id: "delay", node_type: "DELAY", input: { minutes: 2 }, started_at: "2026-09-26T19:03:06.000Z" }),
      ],
    });
    expect(timeline.map((e) => e.id)).toEqual(["comment-c1", "msg-early", "step-delay", "msg-late", "step-end"]);
    expect(timeline[2].signal).toMatchObject({ marker: "wait", label: "Espera · 2 min" });
    expect(timeline[4].signal).toMatchObject({ marker: "end", label: "Fluxo concluído" });
  });

  it("CONDITION mostra o braço tomado", () => {
    const timeline = composeTimeline({
      comments: [],
      messages: [],
      steps: [step({ id: "c", node_type: "CONDITION", output: { branch: "false" }, started_at: "2026-09-26T19:03:01.000Z" })],
    });
    expect(timeline[0].signal).toMatchObject({ marker: "logic", label: "Condição", detail: "→ false" });
  });

  it("step failed de QUALQUER tipo vira incidente visível — inclusive SEND_MESSAGE, normalmente omitido", () => {
    const timeline = composeTimeline({
      comments: [],
      messages: [],
      steps: [
        step({
          id: "f",
          node_type: "SEND_MESSAGE",
          status: "failed",
          attempt: 2,
          error: { message: "Fora da janela de 24h" },
          started_at: "2026-09-26T19:03:01.000Z",
        }),
      ],
    });
    expect(timeline).toHaveLength(1);
    expect(timeline[0].signal).toMatchObject({
      marker: "error",
      label: "Falha · Envio de mensagem · tentativa 2",
      detail: "Fora da janela de 24h",
    });
  });

  it("PUBLIC_REPLY bem-sucedido segue como entrada de AUTOMATION no canal comentário; falho vira incidente, não texto", () => {
    const ok = composeTimeline({
      comments: [],
      messages: [],
      steps: [step({ id: "p", node_type: "PUBLIC_REPLY", output: { text: "🦜 oi" }, started_at: "2026-09-26T19:03:02.000Z" })],
    });
    expect(ok[0]).toMatchObject({ actor: "AUTOMATION", channel: "comment", text: "🦜 oi" });
    expect(ok[0].signal).toBeUndefined();

    const failed = composeTimeline({
      comments: [],
      messages: [],
      steps: [step({ id: "p", node_type: "PUBLIC_REPLY", status: "failed", error: { message: "boom" }, started_at: "2026-09-26T19:03:02.000Z" })],
    });
    expect(failed[0].channel).toBe("engine");
    expect(failed[0].text).toBeNull();
    expect(failed[0].signal?.marker).toBe("error");
  });

  it("steps pending/running/skipped não viram entrada", () => {
    const timeline = composeTimeline({
      comments: [],
      messages: [],
      steps: [
        step({ id: "a", node_type: "DELAY", status: "pending", started_at: "2026-09-26T19:03:01.000Z" }),
        step({ id: "b", node_type: "END", status: "skipped", started_at: "2026-09-26T19:03:02.000Z" }),
      ],
    });
    expect(timeline).toHaveLength(0);
  });

  it("DM carrega tipo, opções de quick reply e botão; ator segue direction/origin", () => {
    const timeline = composeTimeline({
      comments: [],
      messages: [
        msg({ id: "q", type: "quick_reply", text: "Quer o vídeo?", payload: { options: [{ title: "Me manda", key: "a" }] } }),
        msg({ id: "click", direction: "inbound", origin: "automation", type: "quick_reply", text: "Me manda", created_at: "2026-09-26T19:03:06.000Z" }),
        msg({ id: "b", type: "button", text: "Aqui", payload: { button: { title: "Abrir", url: "https://x.test" } }, created_at: "2026-09-26T19:03:07.000Z" }),
        msg({ id: "h", origin: "manual", text: "Posso ajudar", created_at: "2026-09-26T19:03:08.000Z" }),
      ],
      steps: [],
    });
    expect(timeline[0]).toMatchObject({ actor: "AUTOMATION", messageType: "quick_reply", options: ["Me manda"] });
    expect(timeline[1]).toMatchObject({ actor: "USER", messageType: "quick_reply" });
    expect(timeline[2].button).toEqual({ title: "Abrir", url: "https://x.test" });
    expect(timeline[3].actor).toBe("HUMAN");
  });
});

describe("loadConversationTimeline — steps de engine", () => {
  it("junta steps de timeline e falhas sem duplicar o mesmo step (failed PUBLIC_REPLY vem nas duas queries)", async () => {
    const supabase = createFakeSupabase();
    supabase.__tables.automation_runs.push({ id: "run-1", conversation_id: "conv-1", status: "failed", started_at: "2026-09-26T19:00:00.000Z" });
    supabase.__tables.automation_run_steps.push(
      step({ id: "kw", node_type: "KEYWORD_MATCH", input: "oi", started_at: "2026-09-26T19:00:01.000Z" }),
      step({ id: "pr", node_type: "PUBLIC_REPLY", status: "failed", error: { message: "rate limit" }, started_at: "2026-09-26T19:00:02.000Z" }),
      step({ id: "sm", node_type: "SEND_MESSAGE", status: "failed", error: { message: "janela" }, started_at: "2026-09-26T19:00:03.000Z" }),
      step({ id: "tag", node_type: "ADD_TAG", started_at: "2026-09-26T19:00:04.000Z" })
    );

    const { timeline, automationRuns } = await loadConversationTimeline(supabase as never, {
      conversationId: "conv-1",
      contactId: "contact-1",
      socialAccountId: "social-1",
    });

    expect(timeline.map((e) => e.id)).toEqual(["step-kw", "step-pr", "step-sm"]); // sem duplicata, sem ADD_TAG
    expect(timeline.filter((e) => e.signal?.marker === "error")).toHaveLength(2);
    expect(automationRuns[0].lastError).toBe("rate limit");
  });
});
