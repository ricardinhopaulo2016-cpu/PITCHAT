import { buildIncidents, buildNodeFailures, type Incident, type NodeFailure, type RawFailures } from "./failures";
import { buildFunnel, sumFunnel, type Funnel, type FunnelCounts, type FunnelStage } from "./funnel";

export type FunnelLoss = { from: FunnelStage; to: FunnelStage; lost: number };

/**
 * Etapas em que a pessoa já pediu e o PITCHAT deveria ter seguido. A passagem
 * de comentário para pedido fica de fora: comentário sem a frase é triagem,
 * não é alguém perdido.
 */
const OPERATIONAL_STAGES: readonly FunnelStage["key"][] = ["executions", "first_dm", "button"];

/** Passagem que mais perde gente em número absoluto. No empate, a mais cedo no funil. */
export function worstFunnelLoss(funnel: Funnel): FunnelLoss | null {
  let worst: FunnelLoss | null = null;
  funnel.stages.forEach((to, index) => {
    const from = funnel.stages[index - 1];
    if (!from || !OPERATIONAL_STAGES.includes(to.key)) return;
    const lost = from.count - to.count;
    if (lost > 0 && (!worst || lost > worst.lost)) worst = { from, to, lost };
  });
  return worst;
}

const LOSS_HINT: Partial<Record<FunnelStage["key"], string>> = {
  executions: "Motivo não registrado: pode ser automação inativa, palavra-chave diferente, atendimento humano ou queda do processamento.",
  first_dm: "Abra a falha por nó antes de mexer no criativo.",
  button: "Revise o caminho entre a primeira DM e o botão.",
};

export function lossHint(loss: FunnelLoss): string {
  return LOSS_HINT[loss.to.key] ?? "";
}

export type FunnelVerdict = { kind: "no_base" } | { kind: "no_loss" } | { kind: "loss"; loss: FunnelLoss };

/** Uma leitura só para a cor e o texto. Sem pedido não há denominador: é "sem base", nunca "nenhuma perda". */
export function funnelVerdict(rows: FunnelCounts[]): FunnelVerdict {
  const totals = sumFunnel(rows);
  if (totals.requests_unique === 0) return { kind: "no_base" };
  const loss = worstFunnelLoss(buildFunnel(totals));
  return loss ? { kind: "loss", loss } : { kind: "no_loss" };
}

export type NodeBottleneck = {
  node: NodeFailure;
  /** Causa mais frequente entre os incidentes listados desse nó; nula se nenhum veio na lista. */
  cause: string | null;
  incident: Incident | null;
};

/**
 * `nodes` já vem ordenado por falhas, do maior para o menor. Os incidentes vêm
 * do mais recente para o mais antigo, então o link aponta para o caso mais novo
 * da causa predominante.
 */
export function topNodeBottleneck(nodes: NodeFailure[], incidents: Incident[]): NodeBottleneck | null {
  const node = nodes[0];
  if (!node) return null;

  // Mesmo critério de `by_node`: a última etapa da execução falhou nesse nó.
  const matches = incidents.filter((incident) => incident.status === "failed" && incident.stepFailed && incident.automationId === node.automationId && incident.nodeId === node.nodeId);
  const counts = new Map<string, number>();
  for (const incident of matches) counts.set(incident.cause, (counts.get(incident.cause) ?? 0) + 1);

  let cause: string | null = null;
  for (const [candidate, count] of counts) {
    if (cause === null || count > (counts.get(cause) ?? 0)) cause = candidate;
  }
  return { node, cause, incident: matches.find((incident) => incident.cause === cause) ?? null };
}

export type NodeVerdict = { kind: "node"; top: NodeBottleneck } | { kind: "without_step"; failures: number } | { kind: "healthy" } | { kind: "no_base" };

/** "Sem falha" só vale com zero falhas definitivas e fonte observada no período. */
export function nodeVerdict(data: RawFailures, observed: boolean): NodeVerdict {
  const top = topNodeBottleneck(buildNodeFailures(data.by_node), buildIncidents(data.incidents));
  if (top) return { kind: "node", top };
  if (data.failed_runs > 0) return { kind: "without_step", failures: data.failed_runs };
  return observed ? { kind: "healthy" } : { kind: "no_base" };
}
