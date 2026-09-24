/**
 * Thresholds do Health Dashboard (`/dashboard/health`) — centralizados aqui
 * de propósito, cada um justificado no comentário ao lado. Nunca um número
 * solto espalhado pela UI/aggregation.
 */
export const HEALTH_THRESHOLDS = {
  /**
   * Um `webhook_events` em `pending` por mais desse tempo sem virar
   * `processed`/`failed` indica que o QStash não chamou de volta (ou o
   * processamento travou) — nunca deveria ficar pending por muito tempo, já
   * que o processamento é assíncrono mas rápido (segundos, não minutos).
   */
  PENDING_WEBHOOK_STUCK_MINUTES: 15,

  /**
   * 1 `invalid_signature` já é sinal suficiente pra aparecer como atenção —
   * foi exatamente esse tipo de evento, em volume, que revelou o bug real do
   * secret errado em 24/09/2026 (achado ao vivo nesta mesma sessão). Vira
   * incidente a partir de um volume que sugere um problema sistêmico (chave
   * errada em produção), não ruído/scanner isolado.
   */
  INVALID_SIGNATURE_WARNING_COUNT: 1,
  INVALID_SIGNATURE_INCIDENT_COUNT: 5,

  /**
   * Falhas em sequência (as N mais recentes, todas failed) sugerem um
   * problema sistemático (conteúdo/config errado na automação), não um erro
   * isolado — 3 é o mesmo número de tentativas de retry configurado em
   * lib/automation/retry-policy.ts, por analogia.
   */
  CONSECUTIVE_FAILURES_WARNING: 3,

  /**
   * `automation_runs.status='running'` por mais desse tempo sem terminar,
   * pausar ou falhar nunca deveria acontecer — `advanceRun` sempre resolve
   * dentro do mesmo invocation (síncrono, sem I/O de longa duração além das
   * chamadas HTTP da Meta). Indica processo morto no meio.
   */
  RUN_STUCK_RUNNING_MINUTES: 10,

  /**
   * `waiting_reason` em ('delay','retry') por mais desse tempo indica
   * callback do QStash perdido — maior que o maior delay/retry configurado
   * até agora (retry máximo: 15min, ver retry-policy.ts; DELAY de teste
   * usado até agora: 2min), com folga.
   */
  WAITING_TOO_LONG_MINUTES: 30,

  /** Teto de itens na Incident Rail — paginação simples, nunca renderiza uma lista sem fim. */
  INCIDENT_RAIL_LIMIT: 20,
} as const;
