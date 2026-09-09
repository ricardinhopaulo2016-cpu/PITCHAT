import { z } from "zod";
import type { Graph, GraphNode, NodeType } from "./graph";
import { nextNode } from "./graph";
import type { Keyword } from "./normalize";
import type { ConditionRule } from "./node-handlers";

/**
 * "Flow spec" = representação sequencial (lista de steps) usada pelo editor
 * V1 (seção 28/30 do briefing: "não comece com um canvas gigante — primeiro
 * um editor de node list/sequencial"). `compileFlowToGraph` traduz isso pro
 * formato real do engine (`Graph`, ver lib/automation/graph.ts);
 * `decompileGraphToFlow` faz o caminho inverso, pra reabrir um fluxo salvo
 * no editor.
 *
 * Limitação V1 deliberada: cada step tem no máximo uma continuação "normal".
 * O único ponto de ramificação é CONDITION, e a saída "false" sempre vai
 * direto pro END (nunca inventamos um segundo braço editável agora — isso é
 * trabalho do editor visual futuro, seção 28). QUICK_REPLY com múltiplas
 * opções também segue linear: todas as opções levam ao mesmo próximo step
 * (o engine já funciona assim, ver lib/automation/engine.ts `nextAfter`) —
 * para ramificar por opção escolhida, use um CONDITION com
 * `quick_reply_clicked` logo depois.
 */

const keywordSchema = z.object({
  value: z.string().min(1),
  matchType: z.enum(["EXACT", "CONTAINS"]),
});

const conditionRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user_replied") }),
  z.object({ type: z.literal("quick_reply_clicked"), optionKey: z.string().min(1) }),
  z.object({ type: z.literal("tag_exists"), tagName: z.string().min(1) }),
  z.object({ type: z.literal("custom_field"), key: z.string().min(1), equals: z.unknown() }),
  z.object({ type: z.literal("conversation_automation_enabled") }),
  z.object({ type: z.literal("variable"), key: z.string().min(1), equals: z.unknown() }),
]);

const flowStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("KEYWORD_MATCH"), keywords: z.array(keywordSchema).min(1) }),
  z.object({ type: z.literal("PUBLIC_REPLY"), variants: z.array(z.string().min(1)).min(1) }),
  z.object({ type: z.literal("PRIVATE_REPLY"), text: z.string().min(1) }),
  z.object({ type: z.literal("SEND_MESSAGE"), text: z.string().min(1) }),
  z.object({
    type: z.literal("QUICK_REPLY"),
    text: z.string().min(1),
    // 13 = máximo confirmado na doc oficial do Send API (docs/PITCHAT_META_INTEGRATION.md §5).
    options: z.array(z.object({ key: z.string().min(1), title: z.string().min(1).max(20) })).min(1).max(13),
  }),
  z.object({ type: z.literal("DELAY"), minutes: z.number().int().positive() }),
  z.object({ type: z.literal("CONDITION"), rule: conditionRuleSchema }),
  z.object({ type: z.literal("ADD_TAG"), tagName: z.string().min(1) }),
  z.object({ type: z.literal("REMOVE_TAG"), tagName: z.string().min(1) }),
  z.object({ type: z.literal("SET_CUSTOM_FIELD"), key: z.string().min(1), value: z.unknown() }),
]);

export type FlowStep = z.infer<typeof flowStepSchema>;
export type FlowStepType = FlowStep["type"];

export const flowSpecSchema = z.object({ steps: z.array(flowStepSchema) });
export type FlowSpec = z.infer<typeof flowSpecSchema>;

export const EMPTY_FLOW: FlowSpec = { steps: [] };

export const FLOW_STEP_TYPES: FlowStepType[] = [
  "KEYWORD_MATCH",
  "PUBLIC_REPLY",
  "PRIVATE_REPLY",
  "SEND_MESSAGE",
  "QUICK_REPLY",
  "DELAY",
  "CONDITION",
  "ADD_TAG",
  "REMOVE_TAG",
  "SET_CUSTOM_FIELD",
];

function stepToData(step: FlowStep): Record<string, unknown> {
  switch (step.type) {
    case "KEYWORD_MATCH":
      return { keywords: step.keywords };
    case "PUBLIC_REPLY":
      return { variants: step.variants };
    case "PRIVATE_REPLY":
      return { text: step.text };
    case "SEND_MESSAGE":
      return { text: step.text };
    case "QUICK_REPLY":
      return { text: step.text, options: step.options };
    case "DELAY":
      return { minutes: step.minutes };
    case "CONDITION":
      return { rule: step.rule };
    case "ADD_TAG":
      return { tagName: step.tagName };
    case "REMOVE_TAG":
      return { tagName: step.tagName };
    case "SET_CUSTOM_FIELD":
      return { key: step.key, value: step.value };
  }
}

/** Converte um GraphNode de volta pro FlowStep equivalente, ou null se o node não vier de um flow spec (ex: RANDOM_SPLIT/HTTP_REQUEST — não suportados pelo editor sequencial V1). */
function dataToStep(node: GraphNode): FlowStep | null {
  const d = node.data ?? {};
  switch (node.type) {
    case "KEYWORD_MATCH":
      if (!Array.isArray(d.keywords)) return null;
      return { type: "KEYWORD_MATCH", keywords: d.keywords as Keyword[] };
    case "PUBLIC_REPLY":
      if (!Array.isArray(d.variants)) return null;
      return { type: "PUBLIC_REPLY", variants: d.variants as string[] };
    case "PRIVATE_REPLY":
      return { type: "PRIVATE_REPLY", text: String(d.text ?? "") };
    case "SEND_MESSAGE":
      return { type: "SEND_MESSAGE", text: String(d.text ?? "") };
    case "QUICK_REPLY":
      if (!Array.isArray(d.options)) return null;
      return {
        type: "QUICK_REPLY",
        text: String(d.text ?? ""),
        options: d.options as { key: string; title: string }[],
      };
    case "DELAY":
      return { type: "DELAY", minutes: Number(d.minutes ?? 0) };
    case "CONDITION":
      return { type: "CONDITION", rule: d.rule as ConditionRule };
    case "ADD_TAG":
      return { type: "ADD_TAG", tagName: String(d.tagName ?? "") };
    case "REMOVE_TAG":
      return { type: "REMOVE_TAG", tagName: String(d.tagName ?? "") };
    case "SET_CUSTOM_FIELD":
      return { type: "SET_CUSTOM_FIELD", key: String(d.key ?? ""), value: d.value };
    default:
      return null;
  }
}

/**
 * Gera o grafo real a partir da lista de steps. Sempre começa em
 * TRIGGER_COMMENT e termina em END; CONDITION é o único ponto com duas
 * saídas (`true` continua a lista, `false` vai direto pro END).
 */
export function compileFlowToGraph(spec: FlowSpec): Graph {
  const nodes: GraphNode[] = [{ id: "trigger", type: "TRIGGER_COMMENT", data: {} }];
  const edges: Graph["edges"] = [];
  let pending: { from: string; label?: string }[] = [{ from: "trigger" }];

  spec.steps.forEach((step, index) => {
    const id = `step-${index}`;
    nodes.push({ id, type: step.type as NodeType, data: stepToData(step) });
    for (const p of pending) edges.push({ from: p.from, to: id, label: p.label });

    if (step.type === "CONDITION") {
      edges.push({ from: id, to: "end", label: "false" });
      pending = [{ from: id, label: "true" }];
    } else {
      pending = [{ from: id }];
    }
  });

  for (const p of pending) edges.push({ from: p.from, to: "end", label: p.label });
  nodes.push({ id: "end", type: "END", data: {} });

  return { nodes, edges };
}

/**
 * Reconstrói a lista de steps a partir de um grafo — inverso de
 * `compileFlowToGraph`. Retorna `null` se o grafo não tiver a forma
 * (estritamente linear, com CONDITION só ramificando true/false-direto-pro-fim)
 * que o editor sequencial sabe representar; nesse caso a UI deve mostrar um
 * aviso em vez de tentar editar (nunca perder/corromper o grafo salvo).
 */
export function decompileGraphToFlow(graph: Graph): FlowSpec | null {
  const trigger = graph.nodes.find((n) => n.type === "TRIGGER_COMMENT");
  if (!trigger) return null;

  const steps: FlowStep[] = [];
  let current = nextNode(graph, trigger.id);
  let guard = 0;

  while (current && current.type !== "END") {
    if (guard++ > 500) return null; // provável ciclo — não é um flow spec válido

    const step = dataToStep(current);
    if (!step) return null;
    steps.push(step);

    current = step.type === "CONDITION" ? nextNode(graph, current.id, "true") : nextNode(graph, current.id);
  }

  return { steps };
}

export function validateFlowSpec(input: unknown): { ok: true; spec: FlowSpec } | { ok: false; error: string } {
  const result = flowSpecSchema.safeParse(input);
  if (!result.success) return { ok: false, error: result.error.issues.map((i) => i.message).join("; ") };
  return { ok: true, spec: result.data };
}

/**
 * Flow de referência do MVP (seção 11 do briefing): comentário → keyword →
 * resposta pública → private reply → quick reply → link → delay 5min →
 * condition → follow-up. Nunca amarrado a um profileId/workspace — quem cria
 * a automação decide o perfil (seção 31 do doc de arquitetura, "nunca
 * hardcode nome de perfil").
 */
export function buildExampleFlow(): FlowSpec {
  return {
    steps: [
      {
        type: "KEYWORD_MATCH",
        keywords: [
          "eu quero",
          "euquero",
          "eu qro",
          "eu qr",
          "eu kero",
          "eu qero",
          "quero o link",
          "manda o link",
          "me manda o link",
          "quero o vídeo",
          "quero saber mais",
          "tenho interesse",
        ].map((value) => ({ value, matchType: "CONTAINS" as const })),
      },
      {
        type: "PUBLIC_REPLY",
        variants: ["Te mandei no direct! 👀", "Olha sua DM ✈️", "Chegou aí no direct 👇"],
      },
      { type: "PRIVATE_REPLY", text: "Oi! Vi seu comentário 👋" },
      {
        type: "QUICK_REPLY",
        text: "Quer que eu te mande o vídeo?",
        options: [{ key: "yes", title: "Me manda o vídeo" }],
      },
      { type: "SEND_MESSAGE", text: "Aqui está: <link>" },
      { type: "DELAY", minutes: 5 },
      { type: "CONDITION", rule: { type: "conversation_automation_enabled" } },
      { type: "SEND_MESSAGE", text: "Conseguiu acessar o link direitinho ou deu algum problema aí?" },
    ],
  };
}
