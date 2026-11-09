import { rate, type Rate } from "./rates";

export const NODE_LABELS: Record<string, string> = {
  KEYWORD_MATCH: "Palavra-chave",
  PUBLIC_REPLY: "Resposta pública",
  PRIVATE_REPLY: "Primeira DM",
  SEND_MESSAGE: "Enviar mensagem",
  QUICK_REPLY: "Mensagem com opções",
  DELAY: "Espera",
  CONDITION: "Condição",
  ADD_TAG: "Adicionar tag",
  REMOVE_TAG: "Remover tag",
  SET_CUSTOM_FIELD: "Preencher campo",
  HTTP_REQUEST: "Requisição externa",
  RANDOM_SPLIT: "Divisão aleatória",
  END: "Fim do fluxo",
  UNKNOWN: "Início do fluxo",
  QUICK_REPLY_RESUME: "Retomada após botão",
  RETRY_RESUME: "Retomada após nova tentativa",
  DELAY_RESUME: "Retomada após espera",
};

export function nodeLabel(nodeType: string | null): string {
  return nodeType && Object.prototype.hasOwnProperty.call(NODE_LABELS, nodeType) ? NODE_LABELS[nodeType] : "Outra etapa";
}

const RUN_STATUS_LABELS = new Map([
  ["running", "Em execução"],
  ["waiting", "Em espera"],
  ["completed", "Concluída"],
  ["failed", "Falhou"],
]);
const STEP_STATUS_LABELS = new Map([
  ["pending", "pendente"],
  ["running", "em execução"],
  ["succeeded", "concluída"],
  ["failed", "falhou"],
  ["skipped", "pulada"],
]);

export function runStatusLabel(status: string): string {
  return RUN_STATUS_LABELS.get(status) ?? "Outro estado";
}

export function stepStatusLabel(status: string): string {
  return STEP_STATUS_LABELS.get(status) ?? "outro estado";
}

const TECHNICAL_CAUSE = "Causa registrada em formato técnico, conteúdo oculto.";
const MAX_CAUSE_LENGTH = 180;
const SECRET_PATTERNS = [
  /\bBearer\s+[^\s,;]+/gi,
  // A aspa opcional cobre `"token":"..."` no meio de uma frase.
  /\b(access_token|appsecret_proof|client_secret|token|secret|signature|authorization|password)\b["']?\s*[=:]\s*[^\s,;&]+/gi,
  /\b(EAA|IGAA|IGQV)[A-Za-z0-9_-]{4,}/g,
  /sha256=[a-f0-9]+/gi,
  /fbtrace_id\S*(\s*\S+)?/gi,
];

/** Tudo que vai para a tela passa aqui: nunca token, segredo, URL ou payload bruto. */
export function sanitizeFailureText(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[") || /<html/i.test(trimmed)) return TECHNICAL_CAUSE;

  let text = trimmed;
  for (const pattern of SECRET_PATTERNS) text = text.replace(pattern, "[oculto]");
  text = text
    .replace(/https?:\/\/\S+/g, "[link oculto]")
    .replace(/\b\d{10,}\b/g, "[id oculto]")
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();

  return text.length > MAX_CAUSE_LENGTH ? `${text.slice(0, MAX_CAUSE_LENGTH - 3)}...` : text;
}

export type ErrorGroup = { cause: string; failures: number };

/** Reagrupa depois de sanitizar: causas que só diferiam no id oculto viram uma. */
export function groupErrors(rows: { cause: string | null; failures: number }[]): ErrorGroup[] {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const cause = sanitizeFailureText(row.cause);
    if (cause === null) continue;
    groups.set(cause, (groups.get(cause) ?? 0) + row.failures);
  }
  return [...groups]
    .map(([cause, failures]) => ({ cause, failures }))
    .sort((a, b) => b.failures - a.failures)
    .slice(0, 10);
}

export type RawNodeFailure = {
  automation_id: string;
  automation_name: string;
  node_id: string;
  node_type: string | null;
  failures: number;
  reached: number;
};

export type NodeFailure = {
  automationId: string;
  automationName: string;
  nodeId: string;
  nodeLabel: string;
  failures: number;
  reached: number;
  rate: Rate;
};

export function buildNodeFailures(rows: RawNodeFailure[]): NodeFailure[] {
  return rows.map((row) => ({
    automationId: row.automation_id,
    automationName: row.automation_name,
    nodeId: row.node_id,
    nodeLabel: nodeLabel(row.node_type),
    failures: row.failures,
    reached: row.reached,
    rate: rate(row.failures, row.reached),
  }));
}

export type RawIncident = {
  run_id: string;
  status: "failed" | "running";
  started_at: string;
  updated_at: string;
  automation_id: string;
  automation_name: string;
  automation_status: string;
  social_account_id: string | null;
  node_id: string | null;
  node_type: string | null;
  step_status: string | null;
  cause: string | null;
};

export type Incident = {
  runShort: string;
  status: "failed" | "running";
  at: string;
  automationId: string;
  automationName: string;
  automationInactive: boolean;
  accountId: string | null;
  nodeLabel: string | null;
  nodeId: string | null;
  /** A última etapa da execução terminou em falha, o critério de `by_node`. */
  stepFailed: boolean;
  cause: string;
};

function incidentCause(row: RawIncident): string {
  if (row.status === "running" && row.step_status !== "failed") return "Execução presa, sem falha registrada.";
  return sanitizeFailureText(row.cause) ?? "Causa não registrada";
}

/** Campos nomeados, sem spread: o que vier a mais da RPC não chega à tela. */
export function buildIncidents(rows: RawIncident[]): Incident[] {
  return rows.map((row) => ({
    runShort: row.run_id.slice(0, 8),
    status: row.status,
    at: row.updated_at,
    automationId: row.automation_id,
    automationName: row.automation_name,
    automationInactive: row.automation_status !== "active",
    accountId: row.social_account_id,
    nodeLabel: row.node_type ? nodeLabel(row.node_type) : null,
    nodeId: row.node_id,
    stepFailed: row.step_status === "failed",
    cause: incidentCause(row),
  }));
}

const RUN_SHORT = /^[0-9a-f]{8}$/i;
const RUN_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?run=` aceita só 8 hex ou UUID e devolve 8 hex minúsculos. */
export function parseRunParam(raw: string | string[] | undefined): string | null {
  if (typeof raw !== "string" || (!RUN_SHORT.test(raw) && !RUN_UUID.test(raw))) return null;
  return raw.slice(0, 8).toLowerCase();
}

export type RawFailures = {
  runs_in_period: number;
  failed_runs: number;
  failed_without_step: number;
  stuck_runs: number;
  retry_attempts: number;
  by_node: RawNodeFailure[];
  errors: { cause: string | null; failures: number }[];
  incidents: RawIncident[];
};

export type RawRunIncident = {
  run_id: string;
  status: string;
  waiting_reason: string | null;
  trigger_source: string;
  started_at: string;
  updated_at: string;
  automation_id: string;
  automation_name: string;
  automation_status: string;
  social_account_id: string | null;
  steps: {
    node_id: string;
    node_type: string | null;
    status: string;
    attempt: number;
    started_at: string;
    cause: string | null;
  }[];
};
