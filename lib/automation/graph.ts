/**
 * Formato do grafo salvo em automation_versions.graph (jsonb).
 * Ver docs/PITCHAT_ARCHITECTURE.md — motor de automação.
 */

export type NodeType =
  | "TRIGGER_COMMENT"
  | "KEYWORD_MATCH"
  | "PUBLIC_REPLY"
  | "PRIVATE_REPLY"
  | "SEND_MESSAGE"
  | "QUICK_REPLY"
  | "DELAY"
  | "CONDITION"
  | "ADD_TAG"
  | "REMOVE_TAG"
  | "SET_CUSTOM_FIELD"
  | "RANDOM_SPLIT"
  | "HTTP_REQUEST"
  | "END";

export type GraphNode = {
  id: string;
  type: NodeType;
  data: Record<string, unknown>;
};

export type GraphEdge = {
  from: string;
  to: string;
  /**
   * Rótulo da aresta — quando um node tem mais de uma saída possível
   * (CONDITION: "true"/"false"; QUICK_REPLY: a `optionKey` escolhida;
   * RANDOM_SPLIT: o índice do branch). Edge sem label = única saída.
   */
  label?: string;
};

export type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

export function findNode(graph: Graph, nodeId: string): GraphNode | undefined {
  return graph.nodes.find((n) => n.id === nodeId);
}

/** Próximo node a partir de um id, respeitando o label da aresta quando houver mais de uma saída. */
export function nextNode(graph: Graph, fromNodeId: string, label?: string): GraphNode | undefined {
  const edge = graph.edges.find(
    (e) => e.from === fromNodeId && (label === undefined || e.label === undefined || e.label === label)
  );
  if (!edge) return undefined;
  return findNode(graph, edge.to);
}
