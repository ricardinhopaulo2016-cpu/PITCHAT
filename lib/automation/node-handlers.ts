import type { GraphNode } from "./graph";
import { matchKeyword, type Keyword } from "./normalize";

/**
 * Contexto de execução — o que o node precisa pra decidir o que fazer.
 * `variables` é o automation_runs.context (jsonb livre, lido/escrito pelos nodes).
 */
export type ExecutionContext = {
  variables: Record<string, unknown>;
  triggerText?: string; // texto do comentário/mensagem que iniciou o run
  quickReplyOptionKey?: string; // presente só ao retomar de um QUICK_REPLY
  userRepliedSinceLastMessage?: boolean;
  contactTags: string[];
  customFields: Record<string, unknown>;
  conversationAutomationEnabled: boolean;
};

export type NodeOutcome =
  | { kind: "no_match" } // KEYWORD_MATCH não bateu — run termina sem disparar nada
  | { kind: "public_reply"; text: string }
  | { kind: "private_reply"; text: string }
  | { kind: "send_message"; text: string }
  | { kind: "quick_reply"; text: string; options: { key: string; title: string }[] }
  | { kind: "delay"; minutes: number }
  | { kind: "branch"; label: string }
  | { kind: "add_tag"; tagName: string }
  | { kind: "remove_tag"; tagName: string }
  | { kind: "set_custom_field"; key: string; value: unknown }
  | {
      kind: "http_request";
      url: string;
      method: string;
      headers?: Record<string, string>;
      body?: unknown;
    }
  | { kind: "end" }
  | { kind: "continue" }; // node sem efeito colateral relevante pro caller (ex: TRIGGER_COMMENT)

/** RNG injetável — testes passam uma função determinística. */
export type Rng = () => number; // [0, 1)

function pickVariant(variants: string[], rng: Rng): string {
  if (variants.length === 0) return "";
  const index = Math.floor(rng() * variants.length);
  return variants[Math.min(index, variants.length - 1)];
}

export function evaluateNode(
  node: GraphNode,
  ctx: ExecutionContext,
  rng: Rng = Math.random
): NodeOutcome {
  switch (node.type) {
    case "TRIGGER_COMMENT":
      return { kind: "continue" };

    case "KEYWORD_MATCH": {
      const keywords = (node.data.keywords ?? []) as Keyword[];
      const match = matchKeyword(ctx.triggerText ?? "", keywords);
      return match ? { kind: "continue" } : { kind: "no_match" };
    }

    case "PUBLIC_REPLY": {
      const variants = (node.data.variants ?? []) as string[];
      return { kind: "public_reply", text: pickVariant(variants, rng) };
    }

    case "PRIVATE_REPLY":
      return { kind: "private_reply", text: String(node.data.text ?? "") };

    case "SEND_MESSAGE": {
      // link_id (seção 33 do briefing) resolvido pelo orquestrador antes de
      // chegar aqui não é responsabilidade do node puro — ele só repassa o
      // texto já resolvido em node.data.text.
      return { kind: "send_message", text: String(node.data.text ?? "") };
    }

    case "QUICK_REPLY": {
      const options = (node.data.options ?? []) as { key: string; title: string }[];
      return { kind: "quick_reply", text: String(node.data.text ?? ""), options };
    }

    case "DELAY":
      return { kind: "delay", minutes: Number(node.data.minutes ?? 0) };

    case "CONDITION":
      return { kind: "branch", label: String(evaluateCondition(node.data.rule, ctx)) };

    case "ADD_TAG":
      return { kind: "add_tag", tagName: String(node.data.tagName ?? "") };

    case "REMOVE_TAG":
      return { kind: "remove_tag", tagName: String(node.data.tagName ?? "") };

    case "SET_CUSTOM_FIELD":
      return {
        kind: "set_custom_field",
        key: String(node.data.key ?? ""),
        value: node.data.value,
      };

    case "RANDOM_SPLIT": {
      const branches = (node.data.branches ?? []) as string[];
      return { kind: "branch", label: pickVariant(branches, rng) };
    }

    case "HTTP_REQUEST":
      return {
        kind: "http_request",
        url: String(node.data.url ?? ""),
        method: String(node.data.method ?? "GET"),
        headers: node.data.headers as Record<string, string> | undefined,
        body: node.data.body,
      };

    case "END":
      return { kind: "end" };

    default:
      return { kind: "continue" };
  }
}

export type ConditionRule =
  | { type: "user_replied" }
  | { type: "quick_reply_clicked"; optionKey: string }
  | { type: "tag_exists"; tagName: string }
  | { type: "custom_field"; key: string; equals: unknown }
  | { type: "conversation_automation_enabled" }
  | { type: "variable"; key: string; equals: unknown };

/**
 * Só avalia o que a Meta API realmente nos dá (seção 18 do briefing — nunca
 * inventar evento que o Instagram não fornece, ex: "clicou no link" sem
 * mecanismo real de tracking).
 */
export function evaluateCondition(rule: unknown, ctx: ExecutionContext): boolean {
  const r = rule as ConditionRule | undefined;
  if (!r || typeof r !== "object") return false;

  switch (r.type) {
    case "user_replied":
      return !!ctx.userRepliedSinceLastMessage;
    case "quick_reply_clicked":
      return ctx.quickReplyOptionKey === r.optionKey;
    case "tag_exists":
      return ctx.contactTags.includes(r.tagName);
    case "custom_field":
      return ctx.customFields[r.key] === r.equals;
    case "conversation_automation_enabled":
      return ctx.conversationAutomationEnabled;
    case "variable":
      return ctx.variables[r.key] === r.equals;
    default:
      return false;
  }
}
