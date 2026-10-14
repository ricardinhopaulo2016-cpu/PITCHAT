import { z } from "zod";
import type { Graph, GraphEdge, GraphNode, NodeType } from "./graph";
import { checkUrlAllowed } from "./ssrf-guard";

/**
 * Validador AUTORITATIVO do grafo de automação (E1). Função pura, sem I/O —
 * roda no servidor em todo ponto que grava ou ativa um grafo (draft, publish,
 * ativar, duplicar, seed) e pode rodar igual no cliente (canvas, E2).
 *
 * Duas severidades:
 * - `error`: o grafo NÃO pode ser publicado/ativado (o engine falharia, travaria
 *   ou faria algo diferente do que o desenho mostra).
 * - `warning`: roda, mas com comportamento que quem desenhou provavelmente não
 *   espera (ex: condição que hoje sempre dá falso).
 *
 * Dois estágios:
 * - `draft`: rascunho em edição. Problemas de COMPLETUDE (ramo sem saída, nó
 *   solto, nenhuma ação) viram warning — o rascunho vazio (trigger → end) precisa
 *   poder ser salvo.
 * - `publish`: publicar/ativar. Tudo vira error.
 *
 * As regras de rótulo espelham `pickEdge` em graph.ts: aresta de rótulo igual
 * vence; a aresta sem rótulo é o curinga.
 */

export type GraphIssueSeverity = "error" | "warning";
export type ValidationStage = "draft" | "publish";

export type GraphIssue = {
  severity: GraphIssueSeverity;
  code: string;
  nodeId?: string;
  message: string;
};

export type GraphValidation = {
  ok: boolean;
  errors: GraphIssue[];
  warnings: GraphIssue[];
};

const NODE_TYPES: NodeType[] = [
  "TRIGGER_COMMENT",
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
  "RANDOM_SPLIT",
  "HTTP_REQUEST",
  "END",
];

/** Códigos de completude: viram warning no estágio `draft`. */
const COMPLETENESS_CODES = new Set(["DEAD_END", "MISSING_BRANCH_EDGE", "UNREACHABLE_NODE", "NO_ACTION"]);

/** Nós que de fato fazem algo (um fluxo só com trigger/keyword/end não faz nada). */
const ACTION_TYPES = new Set<NodeType>([
  "PUBLIC_REPLY",
  "PRIVATE_REPLY",
  "SEND_MESSAGE",
  "QUICK_REPLY",
  "ADD_TAG",
  "REMOVE_TAG",
  "SET_CUSTOM_FIELD",
  "HTTP_REQUEST",
]);

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

const nonEmpty = z.string().trim().min(1);

// 13 / 20 = limites confirmados na doc oficial do Send API (docs/PITCHAT_META_INTEGRATION.md §5),
// os mesmos do editor sequencial (flow-spec.ts).
const quickOptionsSchema = z
  .array(z.object({ key: nonEmpty, title: nonEmpty.max(20) }))
  .min(1)
  .max(13);

const conditionRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user_replied") }),
  z.object({ type: z.literal("quick_reply_clicked"), optionKey: nonEmpty }),
  z.object({ type: z.literal("tag_exists"), tagName: nonEmpty }),
  z.object({ type: z.literal("custom_field"), key: nonEmpty, equals: z.unknown() }),
  z.object({ type: z.literal("conversation_automation_enabled") }),
  z.object({ type: z.literal("variable"), key: nonEmpty, equals: z.unknown() }),
]);

const keywordsSchema = z
  .array(z.object({ value: nonEmpty, matchType: z.enum(["EXACT", "CONTAINS"]) }))
  .min(1);

function isHttpUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

function zodMessage(error: z.ZodError): string {
  return error.issues
    .map((i) => (i.path.length ? `${i.path.join(".")}: ${i.message}` : i.message))
    .join("; ");
}

export function validateGraph(input: unknown, opts: { stage?: ValidationStage } = {}): GraphValidation {
  const stage: ValidationStage = opts.stage ?? "publish";
  const issues: GraphIssue[] = [];
  const add = (code: string, message: string, nodeId?: string, severity: GraphIssueSeverity = "error") => {
    const demoted = stage === "draft" && COMPLETENESS_CODES.has(code);
    issues.push({ severity: demoted ? "warning" : severity, code, message, ...(nodeId ? { nodeId } : {}) });
  };

  const finish = (): GraphValidation => {
    const errors = issues.filter((i) => i.severity === "error");
    const warnings = issues.filter((i) => i.severity === "warning");
    return { ok: errors.length === 0, errors, warnings };
  };

  const g = input as Partial<Graph> | null;
  if (!g || typeof g !== "object" || !Array.isArray(g.nodes) || !Array.isArray(g.edges)) {
    add("INVALID_SHAPE", "O grafo precisa ter as listas `nodes` e `edges`.");
    return finish();
  }
  const nodes = g.nodes as GraphNode[];
  const edges = g.edges as GraphEdge[];

  // ---- Nós: ids, tipos, trigger/end -------------------------------------------------
  const byId = new Map<string, GraphNode>();
  for (const n of nodes) {
    if (!n || typeof n.id !== "string" || n.id.trim() === "") {
      add("INVALID_NODE_ID", "Existe um nó sem id.");
      continue;
    }
    if (byId.has(n.id)) {
      add("DUPLICATE_NODE_ID", `O id "${n.id}" aparece em mais de um nó.`, n.id);
      continue;
    }
    byId.set(n.id, n);
    if (!NODE_TYPES.includes(n.type)) {
      add("UNKNOWN_NODE_TYPE", `Tipo de nó desconhecido: "${String(n.type)}".`, n.id);
    }
  }

  const triggers = [...byId.values()].filter((n) => n.type === "TRIGGER_COMMENT");
  if (triggers.length === 0) add("NO_TRIGGER", "O fluxo precisa de um gatilho (TRIGGER_COMMENT).");
  if (triggers.length > 1) add("MULTIPLE_TRIGGERS", "O fluxo só pode ter um gatilho.", triggers[1].id);
  if (![...byId.values()].some((n) => n.type === "END")) add("NO_END", "O fluxo precisa de pelo menos um nó END.");

  // ---- Arestas ----------------------------------------------------------------------
  const out = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    if (!e || !byId.has(e.from) || !byId.has(e.to)) {
      add(
        "EDGE_UNKNOWN_NODE",
        `Aresta aponta para um nó que não existe (${String(e?.from)} → ${String(e?.to)}).`,
        e && byId.has(e.from) ? e.from : undefined
      );
      continue;
    }
    if (!out.has(e.from)) out.set(e.from, []);
    out.get(e.from)!.push(e);
  }

  for (const [id, list] of out) {
    const node = byId.get(id)!;
    const seen = new Set<string>();
    for (const e of list) {
      const key = e.label ?? "";
      if (seen.has(key)) {
        add(
          "DUPLICATE_EDGE_LABEL",
          e.label === undefined
            ? "Duas saídas sem rótulo no mesmo nó (só a primeira seria usada)."
            : `Duas saídas com o rótulo "${e.label}" no mesmo nó.`,
          id
        );
      }
      seen.add(key);
    }
    if (node.type === "END") add("END_HAS_OUTGOING", "O nó END não pode ter saída.", id);
  }

  // ---- Rótulos e saídas por tipo ----------------------------------------------------
  for (const node of byId.values()) {
    if (node.type === "END") continue;
    const list = out.get(node.id) ?? [];
    if (list.length === 0) {
      add("DEAD_END", "Este nó não tem saída: a run terminaria aqui sem chegar ao END.", node.id);
      continue;
    }
    const labeled = list.filter((e) => e.label !== undefined);
    const hasWildcard = list.some((e) => e.label === undefined);
    const labels = new Set(labeled.map((e) => e.label as string));

    const requireBranches = (expected: string[]) => {
      for (const l of labeled) {
        if (!expected.includes(l.label as string)) {
          add("INVALID_EDGE_LABEL", `Saída com rótulo "${l.label}" que este nó não produz.`, node.id);
        }
      }
      const missing = expected.filter((l) => !labels.has(l));
      if (missing.length > 0 && !hasWildcard) {
        add("MISSING_BRANCH_EDGE", `Faltam saídas para: ${missing.join(", ")}.`, node.id);
      }
    };

    switch (node.type) {
      case "CONDITION":
        requireBranches(["true", "false"]);
        break;
      case "RANDOM_SPLIT": {
        const branches = Array.isArray(node.data?.branches) ? (node.data.branches as unknown[]) : [];
        requireBranches(branches.filter((b): b is string => typeof b === "string"));
        break;
      }
      case "QUICK_REPLY": {
        const opts = Array.isArray(node.data?.options) ? (node.data.options as { key?: unknown }[]) : [];
        requireBranches(opts.map((o) => o?.key).filter((k): k is string => typeof k === "string"));
        break;
      }
      default:
        if (labeled.length > 0) {
          add("INVALID_EDGE_LABEL", "Este tipo de nó tem uma única saída, sem rótulo.", node.id);
        }
        if (list.length > 1) {
          add("MULTIPLE_OUTGOING", "Este tipo de nó só pode ter uma saída.", node.id);
        }
    }
  }

  // ---- Alcançabilidade e ciclos -----------------------------------------------------
  const succ = (id: string) => (out.get(id) ?? []).map((e) => e.to);

  if (triggers.length === 1) {
    const reached = new Set<string>([triggers[0].id]);
    const queue = [triggers[0].id];
    while (queue.length) {
      for (const to of succ(queue.shift()!)) {
        if (!reached.has(to)) {
          reached.add(to);
          queue.push(to);
        }
      }
    }
    for (const id of byId.keys()) {
      if (!reached.has(id)) add("UNREACHABLE_NODE", "Este nó não é alcançável a partir do gatilho.", id);
    }
  }

  // DFS iterativo (3 cores) — o engine não suporta ciclos (MAX_STEPS_PER_INVOCATION).
  const color = new Map<string, 0 | 1 | 2>();
  let cycleAt: string | null = null;
  for (const start of byId.keys()) {
    if (cycleAt || color.get(start)) continue;
    const stack: { id: string; i: number }[] = [{ id: start, i: 0 }];
    color.set(start, 1);
    while (stack.length && !cycleAt) {
      const top = stack[stack.length - 1];
      const next = succ(top.id);
      if (top.i >= next.length) {
        color.set(top.id, 2);
        stack.pop();
        continue;
      }
      const to = next[top.i++];
      const c = color.get(to) ?? 0;
      if (c === 1) cycleAt = to;
      else if (c === 0) {
        color.set(to, 1);
        stack.push({ id: to, i: 0 });
      }
    }
  }
  if (cycleAt) add("CYCLE", "O fluxo tem um ciclo — o engine não suporta voltar a um nó anterior.", cycleAt);

  // ---- Dados de cada nó -------------------------------------------------------------
  const check = (node: GraphNode, schema: z.ZodType, value: unknown, code = "INVALID_NODE_DATA") => {
    const r = schema.safeParse(value);
    if (!r.success) add(code, zodMessage(r.error), node.id);
    return r.success;
  };

  for (const node of byId.values()) {
    const d = (node.data ?? {}) as Record<string, unknown>;
    switch (node.type) {
      case "KEYWORD_MATCH":
        check(node, keywordsSchema, d.keywords);
        break;
      case "PUBLIC_REPLY":
        check(node, z.array(nonEmpty).min(1), d.variants);
        break;
      case "PRIVATE_REPLY":
        check(node, nonEmpty, d.text);
        if (d.quickReplyOptions !== undefined) check(node, quickOptionsSchema, d.quickReplyOptions);
        break;
      case "SEND_MESSAGE":
        check(node, nonEmpty, d.text);
        if (d.button !== undefined) {
          const ok = check(node, z.object({ title: nonEmpty, url: z.string() }), d.button);
          if (ok && !isHttpUrl((d.button as { url: string }).url)) {
            add("INVALID_NODE_DATA", "button.url precisa ser uma URL http(s) válida.", node.id);
          }
        }
        break;
      case "QUICK_REPLY": {
        check(node, nonEmpty, d.text);
        if (check(node, quickOptionsSchema, d.options)) {
          const keys = (d.options as { key: string }[]).map((o) => o.key);
          if (new Set(keys).size !== keys.length) {
            add("INVALID_NODE_DATA", "As opções do quick reply precisam ter chaves únicas.", node.id);
          }
        }
        break;
      }
      case "DELAY":
        check(node, z.number().int().positive(), d.minutes);
        if (typeof d.minutes === "number" && d.minutes > 24 * 60) {
          add(
            "DELAY_OVER_24H",
            "Delay maior que 24h: passada a janela de mensagens do Instagram, o envio seguinte pode ser recusado pela Meta.",
            node.id,
            "warning"
          );
        }
        break;
      case "CONDITION": {
        if (check(node, conditionRuleSchema, d.rule)) {
          const t = (d.rule as { type: string }).type;
          if (t === "user_replied" || t === "tag_exists" || t === "custom_field") {
            add(
              "CONDITION_RULE_UNRELIABLE",
              `A regra "${t}" ainda não é alimentada pelo engine (tags, campos e resposta do usuário começam vazios): hoje ela dá sempre falso.`,
              node.id,
              "warning"
            );
          }
        }
        break;
      }
      case "ADD_TAG":
      case "REMOVE_TAG":
        check(node, nonEmpty, d.tagName);
        break;
      case "SET_CUSTOM_FIELD":
        check(node, nonEmpty, d.key);
        add(
          "SET_CUSTOM_FIELD_NOT_PERSISTED",
          "SET_CUSTOM_FIELD só vale dentro desta run: o valor ainda não é gravado no contato.",
          node.id,
          "warning"
        );
        break;
      case "RANDOM_SPLIT": {
        if (check(node, z.array(nonEmpty).min(2), d.branches)) {
          const b = d.branches as string[];
          if (new Set(b).size !== b.length) add("INVALID_NODE_DATA", "Os ramos do RANDOM_SPLIT precisam ser únicos.", node.id);
        }
        break;
      }
      case "HTTP_REQUEST": {
        if (typeof d.url !== "string" || d.url.trim() === "") {
          add("INVALID_NODE_DATA", "HTTP_REQUEST precisa de uma url.", node.id);
        } else {
          const ssrf = checkUrlAllowed(d.url);
          if (!ssrf.allowed) add("HTTP_URL_BLOCKED", `URL bloqueada: ${ssrf.reason}.`, node.id);
        }
        if (d.method !== undefined && !HTTP_METHODS.has(String(d.method).toUpperCase())) {
          add("INVALID_NODE_DATA", "method precisa ser GET, POST, PUT, PATCH ou DELETE.", node.id);
        }
        break;
      }
      default:
        break;
    }
  }

  // ---- Semântica --------------------------------------------------------------------
  // Depois de um QUICK_REPLY a run retoma a partir do postback, sem o id do
  // comentário (ingestInstagramQuickReply passa commentId: null): PUBLIC_REPLY e
  // PRIVATE_REPLY jogariam erro. Só o que vem do comentário original pode responder a ele.
  for (const qr of byId.values()) {
    if (qr.type !== "QUICK_REPLY") continue;
    const seen = new Set<string>();
    const queue = succ(qr.id);
    while (queue.length) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const n = byId.get(id);
      if (n && (n.type === "PUBLIC_REPLY" || n.type === "PRIVATE_REPLY")) {
        add(
          "REPLY_AFTER_QUICK_REPLY",
          `${n.type} depois de um QUICK_REPLY: a run retoma sem o comentário original e este passo falharia.`,
          n.id
        );
      }
      queue.push(...succ(id));
    }
  }

  if (![...byId.values()].some((n) => n.type === "KEYWORD_MATCH")) {
    add(
      "NO_KEYWORD_MATCH",
      "Sem KEYWORD_MATCH, o fluxo dispara em TODO comentário do perfil.",
      undefined,
      "warning"
    );
  }

  if (![...byId.values()].some((n) => ACTION_TYPES.has(n.type))) {
    add("NO_ACTION", "O fluxo não faz nada: adicione ao menos uma resposta, mensagem ou ação.");
  }

  return finish();
}

/** Resumo curto (uma linha) para mensagens de erro de API/UI. */
export function summarizeIssues(v: GraphValidation, max = 3): string {
  const parts = v.errors.slice(0, max).map((e) => (e.nodeId ? `[${e.nodeId}] ${e.message}` : e.message));
  const extra = v.errors.length - max;
  return parts.join(" · ") + (extra > 0 ? ` (+${extra})` : "");
}

/** Corpo padrão (HTTP 422) das rotas quando o grafo não passa na validação. `detail` é lido direto pela UI. */
export function invalidGraphBody(v: GraphValidation) {
  return { error: "INVALID_GRAPH", detail: summarizeIssues(v), issues: v.errors, warnings: v.warnings };
}
