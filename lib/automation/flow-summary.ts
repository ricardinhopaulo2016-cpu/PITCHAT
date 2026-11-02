import type { Graph, GraphNode } from "./graph";

export type FlowStep = { id: string; title: string; detail?: string };

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function describe(node: GraphNode): FlowStep | null {
  const d = node.data ?? {};
  switch (node.type) {
    case "TRIGGER_COMMENT":
      return { id: node.id, title: "Comentário no post" };
    case "KEYWORD_MATCH": {
      const keywords = Array.isArray(d.keywords) ? d.keywords.map((k) => asText((k as { value?: unknown }).value)).filter(Boolean) : [];
      return { id: node.id, title: "Palavra-chave", detail: keywords.join(", ") || undefined };
    }
    case "PUBLIC_REPLY":
      return { id: node.id, title: "Resposta pública", detail: Array.isArray(d.variants) ? asText(d.variants[0]) : undefined };
    case "PRIVATE_REPLY":
      return { id: node.id, title: "Primeira DM", detail: asText(d.text) };
    case "SEND_MESSAGE":
      return { id: node.id, title: "Mensagem", detail: asText(d.text) };
    case "QUICK_REPLY":
      return { id: node.id, title: "Mensagem com opções", detail: asText(d.text) };
    case "DELAY": {
      const minutes = Number(d.minutes ?? 0);
      return { id: node.id, title: "Espera", detail: minutes > 0 ? `${minutes} min` : undefined };
    }
    case "CONDITION":
      return { id: node.id, title: "Condição" };
    case "RANDOM_SPLIT":
      return { id: node.id, title: "Divisão de teste" };
    case "ADD_TAG":
    case "REMOVE_TAG":
    case "SET_CUSTOM_FIELD":
    case "HTTP_REQUEST":
    case "END":
      return null; // Bastidor: não muda o que a pessoa recebe.
  }
}

/**
 * O caminho principal do fluxo, para ler de relance: parte do gatilho e segue a
 * primeira saída de cada passo. Não substitui o editor, que mostra os ramos.
 */
export function summarizeFlow(graph: Graph | null | undefined): FlowStep[] {
  if (!graph?.nodes?.length) return [];
  const start = graph.nodes.find((n) => n.type === "TRIGGER_COMMENT") ?? graph.nodes[0];
  const steps: FlowStep[] = [];
  const seen = new Set<string>();
  let current: GraphNode | undefined = start;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    const step = describe(current);
    if (step) steps.push(step);
    const fromId: string = current.id;
    const edge = graph.edges?.find((e) => e.from === fromId);
    current = edge ? graph.nodes.find((n) => n.id === edge.to) : undefined;
  }
  return steps;
}
