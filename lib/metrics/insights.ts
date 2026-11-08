import { HEALTH_THRESHOLDS } from "@/lib/health/thresholds";
import { GOAL_PER_POST, MAX_INSIGHTS } from "./constants";
import type { NodeFailure } from "./failures";
import { formatPeakHour, type QueueState } from "./flow";
import type { FunnelCounts } from "./funnel";
import { displayName, formatCount } from "./rates";
import { formatDuration, type Distribution } from "./response-time";
import type { GoalPost } from "./viral";

export type Insight = {
  id: string;
  severity: "action" | "attention" | "info";
  text: string;
  action: string;
  periodLabel: string;
  value: number;
  href?: string;
};

export type InsightInput = {
  periodLabel: string;
  now: Date;
  funnel: FunnelCounts | null;
  failures: { failedRuns: number; topNode: NodeFailure | null } | null;
  internalLatency: Distribution | null;
  peak: { hour: string; total: number } | null;
  activeHours: number;
  averageHourly: number | null;
  queue: QueueState | null;
  postsUnlinked: number | null;
  todayRequests: number | null;
  yesterdaySameTimeRequests: number | null;
  bestGoalPost: GoalPost | null;
};

const REQUESTS_DROP_MIN_HOUR = 6;
const SLOW_P95_SECONDS = 120;

function saoPauloHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(now)
  );
}

function pendingExecution(input: InsightInput): Insight | null {
  if (!input.funnel) return null;
  const n = input.funnel.requests_unique - input.funnel.executions;
  if (n < 5) return null;
  return {
    id: "pending_execution",
    severity: "action",
    text: `${formatCount(n)} pedidos sem execução de automação ${input.periodLabel}.`,
    action: "Confira se havia automação ativa no perfil antes de mexer no criativo.",
    periodLabel: input.periodLabel,
    value: n,
  };
}

function executionWithoutDm(input: InsightInput): Insight | null {
  if (!input.funnel) return null;
  const n = input.funnel.executions - input.funnel.first_dm;
  if (n < 3) return null;
  return {
    id: "execution_without_dm",
    severity: "action",
    text: `${formatCount(n)} pessoas com execução iniciada e sem DM enviada ${input.periodLabel}.`,
    action: "Abra a falha por nó antes de mexer no criativo.",
    periodLabel: input.periodLabel,
    value: n,
  };
}

function nodeFailureConcentrated(input: InsightInput): Insight | null {
  const top = input.failures?.topNode;
  if (!input.failures || !top) return null;
  const total = input.failures.failedRuns;
  if (top.failures < 5 || top.failures * 2 < total) return null;
  const automation = displayName(top.automationName);
  return {
    id: "node_failure_concentrated",
    severity: "action",
    text: `${formatCount(top.failures)} de ${formatCount(total)} falhas definitivas ${input.periodLabel} ocorreram em ${top.nodeLabel} da automação ${automation}.`,
    action: "Veja a causa registrada nesse nó.",
    periodLabel: input.periodLabel,
    value: top.failures,
    href: "#falhas",
  };
}

function staleWaiting(input: InsightInput): Insight | null {
  if (!input.queue) return null;
  const { delay, retry, oldestMinutes } = input.queue.runs;
  const n = delay + retry;
  if (n < 1 || oldestMinutes === null || oldestMinutes < HEALTH_THRESHOLDS.WAITING_TOO_LONG_MINUTES) return null;
  return {
    id: "stale_waiting",
    severity: "attention",
    text: `${formatCount(n)} ${n === 1 ? "execução" : "execuções"} em espera agora, a mais antiga há ${formatCount(oldestMinutes)} min.`,
    action: "Confira a fila de tarefas em Saúde.",
    periodLabel: "agora",
    value: n,
    href: "/dashboard/health",
  };
}

function lowButtonRate(input: InsightInput): Insight | null {
  if (!input.funnel) return null;
  const { first_dm: firstDm, button } = input.funnel;
  if (firstDm < 20 || button / firstDm >= 0.5) return null;
  const percent = Math.round((button / firstDm) * 100);
  return {
    id: "low_button_rate",
    severity: "attention",
    text: `${percent}% das ${formatCount(firstDm)} pessoas com primeira DM receberam mensagem com botão ${input.periodLabel}.`,
    action: "Revise o caminho entre a primeira DM e o botão.",
    periodLabel: input.periodLabel,
    value: percent,
  };
}

function requestsDrop(input: InsightInput): Insight | null {
  const { todayRequests: today, yesterdaySameTimeRequests: yesterday } = input;
  if (today === null || yesterday === null) return null;
  if (yesterday < 10 || today * 2 > yesterday || saoPauloHour(input.now) < REQUESTS_DROP_MIN_HOUR) return null;
  return {
    id: "requests_drop",
    severity: "attention",
    text: `${formatCount(today)} pedidos únicos hoje contra ${formatCount(yesterday)} ontem até esta hora.`,
    action: "Confira se saiu post novo antes de alterar a automação.",
    periodLabel: "hoje contra ontem até esta hora",
    value: today,
  };
}

function slowInternal(input: InsightInput): Insight | null {
  const latency = input.internalLatency;
  if (!latency || latency.samples < 20 || latency.p95 === null || latency.p95 <= SLOW_P95_SECONDS) return null;
  return {
    id: "slow_internal",
    severity: "attention",
    text: `Entre os pedidos que receberam DM ${input.periodLabel}, 95% receberam em até ${formatDuration(latency.p95)} depois da gravação do comentário, em ${formatCount(latency.samples)} amostras.`,
    action: "Confira a fila de tarefas e erros de envio.",
    periodLabel: input.periodLabel,
    value: latency.p95,
  };
}

function unlinkedPosts(input: InsightInput): Insight | null {
  const n = input.postsUnlinked;
  if (n === null || n < 3) return null;
  return {
    id: "unlinked_posts",
    severity: "info",
    text: `${formatCount(n)} posts com comentários e sem vínculo com agendamento ${input.periodLabel}.`,
    action: "Se saíram pelo PITCHAT, confira o vínculo. Se saíram por fora, nenhuma ação.",
    periodLabel: input.periodLabel,
    value: n,
  };
}

function trafficPeak(input: InsightInput): Insight | null {
  const { peak, activeHours, averageHourly } = input;
  if (!peak || averageHourly === null) return null;
  if (activeHours < 24 || peak.total < 20 || peak.total < 3 * averageHourly) return null;
  return {
    id: "traffic_peak",
    severity: "info",
    text: `Pico de ${formatCount(peak.total)} mensagens em ${formatPeakHour(peak.hour)} ${input.periodLabel}.`,
    action: "Evite mexer em automação ativa nesse horário.",
    periodLabel: input.periodLabel,
    value: peak.total,
  };
}

function goalClose(input: InsightInput): Insight | null {
  const post = input.bestGoalPost;
  if (!post || post.requests < 500) return null;
  return {
    id: "goal_close",
    severity: "info",
    text: `Um post chegou a ${formatCount(post.requests)} de ${formatCount(GOAL_PER_POST)} pedidos únicos, em todo o histórico.`,
    action: "Compare o formato desse post com os próximos.",
    periodLabel: "em todo o histórico",
    value: post.requests,
  };
}

/** A ordem é a prioridade. Fonte nula não gera frase: sem base, não há insight. */
const RULES = [
  pendingExecution,
  executionWithoutDm,
  nodeFailureConcentrated,
  staleWaiting,
  lowButtonRate,
  requestsDrop,
  slowInternal,
  unlinkedPosts,
  trafficPeak,
  goalClose,
];

export function buildInsights(input: InsightInput): Insight[] {
  return RULES.map((rule) => rule(input))
    .filter((insight): insight is Insight => insight !== null)
    .slice(0, MAX_INSIGHTS);
}
