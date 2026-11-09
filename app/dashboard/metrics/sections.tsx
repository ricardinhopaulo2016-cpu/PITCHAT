import { ChevronDown } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignalMarker } from "@/components/icons/pitchat";
import { SectionPanel, Stat } from "@/components/ui/section-panel";
import { GOAL_PER_POST, NO_BASE_LABEL, VIRAL_SIGNAL_MULTIPLIER } from "@/lib/metrics/constants";
import { buildDailySeries, failureCount, isObservedBy, observedCount, readCombinedWindow, windowDelta, type EventKind, type RawDaily, type SourceKey, type Sources, type WindowReading } from "@/lib/metrics/daily";
import {
  buildIncidents,
  buildNodeFailures,
  groupErrors,
  nodeLabel,
  runStatusLabel,
  sanitizeFailureText,
  stepStatusLabel,
  type RawFailures,
  type RawRunIncident,
} from "@/lib/metrics/failures";
import { buildQueueState, findPeak, formatPeakHour, sumBuckets, type FlowBucket, type RawFlow } from "@/lib/metrics/flow";
import { buildFunnel, type FunnelCounts, type RawFunnel } from "@/lib/metrics/funnel";
import type { Insight } from "@/lib/metrics/insights";
import type { ComparisonWindow, MetricsPeriod, WindowKey } from "@/lib/metrics/period";
import { displayName, formatCount, formatDelta, formatRate, rate } from "@/lib/metrics/rates";
import type { RawConfidence } from "@/lib/metrics/repo";
import { COMMENT_TIME_UNAVAILABLE, formatDuration, toDistribution, type Distribution, type RawResponseTimes } from "@/lib/metrics/response-time";
import { resultData, type RpcFailure, type RpcResult } from "@/lib/metrics/rpc";
import { buildGoalPosts, buildViralAccounts, type RawViral } from "@/lib/metrics/viral";
import { todayKey } from "@/lib/ui/date-range";
import { formatDateTime, formatLastActivity } from "@/lib/ui/format";

export type Names = Map<string, string>;

const GATE_MESSAGE: Record<RpcFailure, string> = {
  missing: "Aguardando a atualização do banco para mostrar este bloco.",
  timeout: "A consulta demorou demais. Escolha um período menor.",
  error: "Não foi possível carregar este bloco agora.",
};

/** Para blocos que não dependem do período: trocar o filtro não adiantaria. */
const TIMEOUT_RETRY = "A consulta demorou demais. Tente de novo em instantes.";

export function BlockGate<T>({ result, timeoutMessage, children }: { result: RpcResult<T>; timeoutMessage?: string; children: (data: T) => ReactNode }) {
  if (result.status === "ok") return <>{children(result.data)}</>;
  const message = result.status === "timeout" && timeoutMessage ? timeoutMessage : GATE_MESSAGE[result.status];
  return <p className="px-5 py-4 text-sm text-text-muted">{message}</p>;
}

export function accountLabel(id: string | null, names: Names): string {
  if (!id) return "sem perfil vinculado";
  return names.get(id) ?? "conta removida";
}

export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

export function shortDay(day: string): string {
  return `${day.slice(8)}/${day.slice(5, 7)}`;
}

export function PanelNote({ children }: { children: ReactNode }) {
  return <p className="border-t border-border-subtle px-5 py-3 text-xs text-text-muted">{children}</p>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-5 py-4 text-sm text-text-muted">{children}</p>;
}

/** Detalhe secundário: fica recolhido e abre por clique ou por link com âncora. */
function DetailPanel({ id, title, caption, children }: { id: string; title: string; caption?: string; children: ReactNode }) {
  return (
    <details id={id} className="group overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 transition-colors duration-[var(--motion-fast)] hover:bg-surface-2 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-base font-semibold text-text">{title}</span>
          {caption && <span className="mt-0.5 block text-xs text-text-muted">{caption}</span>}
        </span>
        <ChevronDown aria-hidden="true" className="h-[18px] w-[18px] shrink-0 text-text-muted transition-transform duration-[var(--motion-ui)] group-open:rotate-180" />
      </summary>
      <div className="border-t border-border-subtle">{children}</div>
    </details>
  );
}

function SubHeading({ children }: { children: ReactNode }) {
  return <p className="border-t border-border-subtle px-5 pb-2 pt-4 text-sm font-medium text-text">{children}</p>;
}

type Column = { label: string; numeric?: boolean };

function MetricTable({ columns, rows, wide }: { columns: Column[]; rows: { key: string; cells: ReactNode[] }[]; wide?: boolean }) {
  const align = (column: Column) => (column.numeric ? "text-right" : "text-left");
  return (
    <div className="overflow-x-auto">
      <table className={`w-full text-left ${wide ? "min-w-[860px]" : "min-w-[560px]"}`}>
        <thead>
          <tr className="border-t border-border-subtle text-xs text-text-muted">
            {columns.map((column) => (
              <th key={column.label} className={`px-3 py-2.5 font-normal first:pl-5 last:pr-5 ${align(column)}`}>
                {column.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-t border-border-subtle text-sm text-text-secondary">
              {row.cells.map((cell, index) => (
                <td key={columns[index].label} className={`px-3 py-2.5 tabular-nums first:pl-5 last:pr-5 ${align(columns[index])}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MetricRow({ label, detail, value }: { label: string; detail?: ReactNode; value: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{label}</p>
        {detail && <p className="text-xs text-text-muted">{detail}</p>}
      </div>
      <span className="text-sm tabular-nums text-text-secondary">{value}</span>
    </li>
  );
}

function ProgressBar({ progress }: { progress: number }) {
  return (
    <div className="h-2 rounded bg-surface-3">
      {progress > 0 && <div className="h-2 min-w-1 rounded bg-signal" style={{ width: `${Math.min(100, progress * 100)}%` }} />}
    </div>
  );
}

/* ---------- Incidente de uma execução ---------- */

function stepMarker(status: string): { marker: "action" | "logic" | "error"; color: string } {
  if (status === "succeeded") return { marker: "action", color: "var(--text-secondary)" };
  if (status === "failed") return { marker: "error", color: "var(--danger)" };
  return { marker: "logic", color: "var(--warning)" };
}

function RunDetail({ run, names }: { run: RawRunIncident; names: Names }) {
  return (
    <div>
      <ul className="divide-y divide-border-subtle">
        <MetricRow label="Automação" value={`${displayName(run.automation_name)}${run.automation_status === "active" ? "" : " (inativa)"}`} />
        <MetricRow label="Perfil" value={accountLabel(run.social_account_id, names)} />
        <MetricRow label="Status" value={runStatusLabel(run.status)} />
        <MetricRow label="Início" value={formatDateTime(run.started_at)} />
        <MetricRow label="Última atualização" value={formatDateTime(run.updated_at)} />
      </ul>
      {run.steps.length === 0 ? (
        <PanelNote>Nenhuma etapa registrada nesta execução.</PanelNote>
      ) : (
        <div className="border-t border-border-subtle px-5 py-4">
          <ol className="flex flex-col gap-3 border-l-2 border-border pl-5">
            {run.steps.map((step, index) => {
              const cfg = stepMarker(step.status);
              const cause = sanitizeFailureText(step.cause) ?? (step.status === "failed" ? "Causa não registrada" : null);
              return (
                <li key={`${step.node_id}-${step.attempt}-${index}`} className="relative">
                  <span className="absolute -left-[26px] top-[3px]">
                    <SignalMarker type={cfg.marker} style={{ color: cfg.color }} />
                  </span>
                  <p className="font-mono text-xs text-text-muted">{formatDateTime(step.started_at)}</p>
                  <p className="text-sm font-medium text-text">
                    {nodeLabel(step.node_type)}{" "}
                    <span className="font-normal text-text-secondary">
                      {stepStatusLabel(step.status)}, tentativa {formatCount(step.attempt)}
                    </span>
                  </p>
                  {cause && <p className="text-xs text-text-secondary">{cause}</p>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </div>
  );
}

export function RunIncidentSection({ prefix, result, names }: { prefix: string | null; result: RpcResult<RawRunIncident[]> | null; names: Names }) {
  const notFound = <Empty>Nenhuma execução com esse código neste workspace ou perfil.</Empty>;
  return (
    <SectionPanel id="incidente" title={prefix ? `Incidente run ${prefix}` : "Incidente"}>
      {result === null ? (
        notFound
      ) : (
        <BlockGate result={result} timeoutMessage={TIMEOUT_RETRY}>
          {(runs) =>
            runs.length === 0 ? (
              notFound
            ) : (
              <div className="divide-y divide-border-subtle">
                {runs.map((run, index) => (
                  // Índice, não run_id: a key vai para o HTML e o id completo não pode sair na tela.
                  <RunDetail key={index} run={run} names={names} />
                ))}
              </div>
            )
          }
        </BlockGate>
      )}
    </SectionPanel>
  );
}

/* ---------- Confiança dos dados ---------- */

const SOURCE_LABELS: { key: SourceKey; label: string }[] = [
  { key: "comments", label: "Comentários" },
  { key: "messages_inbound", label: "Mensagens recebidas" },
  { key: "messages_outbound", label: "Mensagens enviadas" },
  { key: "runs", label: "Execuções" },
  { key: "posts", label: "Posts publicados pelo PITCHAT" },
];

export function ConfidenceSection({ result, period }: { result: RpcResult<RawConfidence>; period: MetricsPeriod }) {
  return (
    <DetailPanel id="confianca" title="Confiança dos dados" caption={`Avisos do recorte ${period.label}. Comentários novos usam o horário real do Instagram; os antigos, a hora de gravação no PITCHAT.`}>
      <BlockGate result={result}>
        {(data) => (
          <>
            <div className="flex flex-wrap">
              <Stat label="Posts observados" value={formatCount(data.posts_observed)} />
              <Stat label="Sem vínculo com agendamento" value={formatCount(data.posts_unlinked)} caption="publicado fora do PITCHAT ou vínculo pendente" />
              <Stat label="Publicados sem id de mídia" value={formatCount(data.posts_published_without_media_id)} />
              <Stat label="Comentários sem contato" value={formatCount(data.comments_without_contact)} />
              <Stat label="Reconciliados pelo evento" value={formatCount(data.comments_contact_reconciled)} />
              <Stat label="Sem autor" value={formatCount(data.comments_without_author)} />
              <Stat label="Pedidos sem execução" value={formatCount(data.requests_without_execution)} color={data.requests_without_execution > 0 ? "var(--warning)" : undefined} />
              <Stat label="Execuções sem comentário" value={formatCount(data.runs_comment_not_found)} />
              <Stat label="Execuções de automações inativas" value={formatCount(data.runs_inactive_automation)} />
            </div>
            <SubHeading>Última atividade por fonte, sem depender do período</SubHeading>
            <ul className="divide-y divide-border-subtle border-t border-border-subtle">
              {SOURCE_LABELS.map(({ key, label }) => {
                const last = data.sources[key].last;
                return <MetricRow key={key} label={label} value={last ? formatLastActivity(last) : "sem registro"} />;
              })}
            </ul>
            <PanelNote>Automações apagadas levam junto o histórico de execução.</PanelNote>
          </>
        )}
      </BlockGate>
    </DetailPanel>
  );
}

/* ---------- Insights ---------- */

const INSIGHT_MARKER: Record<Insight["severity"], { marker: "action" | "logic" | "error"; color: string }> = {
  action: { marker: "logic", color: "var(--warning)" },
  attention: { marker: "logic", color: "var(--text-secondary)" },
  info: { marker: "action", color: "var(--text-secondary)" },
};

export function InsightsSection({ insights, healthHref }: { insights: Insight[] | null; healthHref: string }) {
  return (
    <SectionPanel id="insights" title="Insights">
      {insights === null ? (
        <Empty>Insights indisponíveis enquanto os dados não carregam.</Empty>
      ) : insights.length === 0 ? (
        <Empty>Nada a destacar com os dados deste período.</Empty>
      ) : (
        <ul className="divide-y divide-border-subtle">
          {insights.map((insight) => {
            const cfg = INSIGHT_MARKER[insight.severity];
            const href = insight.href === "/dashboard/health" ? healthHref : insight.href;
            return (
              <li key={insight.id} className="flex items-start gap-2.5 px-5 py-3">
                <span className="mt-[3px] shrink-0">
                  <SignalMarker type={cfg.marker} style={{ color: cfg.color }} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text">{insight.text}</p>
                  <p className="text-sm text-text-secondary">
                    {insight.action}
                    {href && (
                      <>
                        {" "}
                        {href.startsWith("#") ? (
                          // Âncora nativa: dispara o hashchange que abre o bloco recolhido.
                          <a href={href} className="underline hover:text-text">
                            Abrir
                          </a>
                        ) : (
                          <Link href={href} className="underline hover:text-text">
                            Abrir
                          </Link>
                        )}
                      </>
                    )}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </SectionPanel>
  );
}

/* ---------- Evolução ---------- */

const COMPARISON_ROWS: { label: string; kinds: EventKind[] }[] = [
  { label: "Posts publicados pelo PITCHAT", kinds: ["post_published"] },
  { label: "Comentários recebidos", kinds: ["comment_valid"] },
  { label: "Pedidos únicos", kinds: ["request_unique"] },
  { label: "Disparos", kinds: ["run_started"] },
  { label: "DMs (automação)", kinds: ["dm_automation"] },
  { label: "DMs (Inbox)", kinds: ["dm_manual"] },
  { label: "Falhas", kinds: ["failure_run", "failure_message"] },
];

const COMPARISON_COLUMNS: Column[] = [
  { label: "Métrica" },
  { label: "Hoje (parcial)", numeric: true },
  { label: "Ontem até esta hora", numeric: true },
  { label: "Variação", numeric: true },
  { label: "Ontem inteiro", numeric: true },
  { label: "7 dias completos", numeric: true },
  { label: "7 dias anteriores", numeric: true },
  { label: "Variação 7 dias", numeric: true },
];

type WindowResults = Record<WindowKey, RpcResult<Record<string, number>>>;

function WindowCell({ reading }: { reading: WindowReading }) {
  return (
    <span className="whitespace-nowrap">
      {formatCount(reading.value)}
      {reading.coverage === "partial" && reading.value !== null && <span className="ml-2 text-xs text-text-muted">parcial</span>}
    </span>
  );
}

function ComparisonTable({ windows, windowList, sources, postsUnlinked }: { windows: WindowResults; windowList: ComparisonWindow[]; sources: Sources | null; postsUnlinked: number | null }) {
  const results = Object.values(windows);
  const firstResult = results[0];
  if (firstResult && firstResult.status !== "ok" && results.every((result) => result.status !== "ok")) {
    return <Empty>{firstResult.status === "timeout" ? TIMEOUT_RETRY : GATE_MESSAGE[firstResult.status]}</Empty>;
  }

  const read = (kinds: EventKind[], key: WindowKey): WindowReading => {
    const window = windowList.find((w) => w.key === key);
    return window ? readCombinedWindow(kinds, resultData(windows[key]), window, sources) : { value: null, coverage: "unknown" };
  };

  return (
    <>
      <MetricTable
        wide
        columns={COMPARISON_COLUMNS}
        rows={COMPARISON_ROWS.map(({ label, kinds }) => {
          const today = read(kinds, "today");
          const sameTime = read(kinds, "yesterday_same_time");
          const last7 = read(kinds, "last7");
          const previous7 = read(kinds, "previous7");
          return {
            key: label,
            cells: [
              <span key="label" className="text-text">
                {label}
              </span>,
              <WindowCell key="today" reading={today} />,
              <WindowCell key="sameTime" reading={sameTime} />,
              formatDelta(windowDelta(today, sameTime)),
              <WindowCell key="yesterday" reading={read(kinds, "yesterday")} />,
              <WindowCell key="last7" reading={last7} />,
              <WindowCell key="previous7" reading={previous7} />,
              formatDelta(windowDelta(last7, previous7)),
            ],
          };
        })}
      />
      <PanelNote>Pedidos únicos de 7 dias são calculados na janela inteira, sem somar os dias. Janela parcial começou antes da primeira observação da fonte e não entra na variação.</PanelNote>
      <PanelNote>
        Posts publicados fora do PITCHAT não entram na contagem de posts.
        {postsUnlinked !== null && postsUnlinked > 0 && ` ${plural(postsUnlinked, "post com comentários no período escolhido está", "posts com comentários no período escolhido estão")} sem vínculo com agendamento.`}
      </PanelNote>
    </>
  );
}

const DAILY_COLUMNS: Column[] = [
  { label: "Dia" },
  { label: "Posts pelo PITCHAT", numeric: true },
  { label: "Comentários", numeric: true },
  { label: "Pedidos únicos", numeric: true },
  { label: "Disparos", numeric: true },
  { label: "DMs (automação)", numeric: true },
  { label: "DMs (Inbox)", numeric: true },
  { label: "Falhas", numeric: true },
];

export function EvolutionSection({
  daily,
  windows,
  windowList,
  period,
  sources,
  now,
  postsUnlinked,
}: {
  daily: RpcResult<RawDaily[]>;
  windows: WindowResults;
  windowList: ComparisonWindow[];
  period: MetricsPeriod;
  sources: Sources | null;
  now: Date;
  postsUnlinked: number | null;
}) {
  return (
    <DetailPanel id="evolucao" title="Comparativo fixo e evolução por dia" caption="O comparativo de hoje, ontem e 7 dias não depende do período escolhido. A tabela por dia, sim.">
      <ComparisonTable windows={windows} windowList={windowList} sources={sources} postsUnlinked={postsUnlinked} />
      <SubHeading>Por dia, {period.label}</SubHeading>
      <BlockGate result={daily}>
        {(rows) => (
          <MetricTable
            wide
            columns={DAILY_COLUMNS}
            rows={buildDailySeries(rows, period.days, sources, todayKey(now))
              .reverse()
              .map((row) => ({
                key: row.day,
                cells: [
                  <span key="day" className="text-text">
                    {shortDay(row.day)}
                    {row.partial && <span className="ml-2 text-xs text-text-muted">parcial</span>}
                  </span>,
                  formatCount(row.values.post_published),
                  formatCount(row.values.comment_valid),
                  formatCount(row.values.request_unique),
                  formatCount(row.values.run_started),
                  formatCount(row.values.dm_automation),
                  formatCount(row.values.dm_manual),
                  formatCount(failureCount(row.values)),
                ],
              }))}
          />
        )}
      </BlockGate>
    </DetailPanel>
  );
}

/* ---------- Funil ---------- */

const FUNNEL_COLUMNS: Column[] = [
  { label: "Comentários válidos", numeric: true },
  { label: "Pedidos únicos", numeric: true },
  { label: "Com execução", numeric: true },
  { label: "Primeira DM", numeric: true },
  { label: "Com botão", numeric: true },
];

function funnelCells(counts: FunnelCounts): ReactNode[] {
  return buildFunnel(counts).stages.map((stage) => (
    <span key={stage.key} className="whitespace-nowrap">
      <span className="text-text">{formatCount(stage.count)}</span>
      {stage.rate && <span className="ml-1.5 text-xs text-text-muted">{formatRate(stage.rate)}</span>}
    </span>
  ));
}

export function FunnelSection({ result, period, names }: { result: RpcResult<RawFunnel>; period: MetricsPeriod; names: Names }) {
  return (
    <DetailPanel id="funil" title="Funil por perfil e por post" caption={`Tabela completa, ${period.label}.`}>
      <BlockGate result={result}>
        {(data) => {
          if (data.by_account.length === 0) return <Empty>Nenhum comentário válido recebido pelo PITCHAT neste período.</Empty>;
          return (
            <>
              <SubHeading>Por perfil</SubHeading>
              <MetricTable
                wide
                columns={[{ label: "Perfil" }, ...FUNNEL_COLUMNS]}
                rows={data.by_account.map((row) => ({
                  key: row.social_account_id,
                  cells: [accountLabel(row.social_account_id, names), ...funnelCells(row)],
                }))}
              />

              <SubHeading>Por post</SubHeading>
              <MetricTable
                wide
                columns={[{ label: "Post" }, ...FUNNEL_COLUMNS]}
                rows={data.by_post.map((row) => {
                  const label = `${accountLabel(row.social_account_id, names)}, post ${row.external_media_id.slice(-5)}`;
                  return {
                    key: `${row.social_account_id}-${row.external_media_id}`,
                    cells: [
                      row.permalink ? (
                        <a key="post" href={row.permalink} target="_blank" rel="noreferrer" className="underline hover:text-text">
                          {label}
                        </a>
                      ) : (
                        label
                      ),
                      ...funnelCells(row),
                    ],
                  };
                })}
              />
              <PanelNote>{`Mostrando ${formatCount(data.by_post.length)} de ${formatCount(data.posts_total)} posts.`}</PanelNote>
            </>
          );
        }}
      </BlockGate>
    </DetailPanel>
  );
}

/* ---------- Fluxo de mensagens ---------- */

const FLOW_COLUMNS: Column[] = [
  { label: "Recebidas", numeric: true },
  { label: "Cliques em resposta rápida", numeric: true },
  { label: "Automação", numeric: true },
  { label: "Inbox", numeric: true },
];

function flowCells(bucket: FlowBucket): ReactNode[] {
  return [formatCount(bucket.inbound), formatCount(bucket.inbound_clicks), formatCount(bucket.outbound_automation), formatCount(bucket.outbound_manual)];
}

export function FlowSection({ result, names, nowIso, period, sources }: { result: RpcResult<RawFlow>; names: Names; nowIso: string; period: MetricsPeriod; sources: Sources | null }) {
  return (
    <DetailPanel id="fluxo" title="Fluxo de mensagens" caption="Totais, por dia, por perfil e por automação. A fila mostra o momento atual.">
      <BlockGate result={result}>
        {(data) => {
          const totals = sumBuckets(data.by_day);
          const inboundCount = (value: number) => observedCount(value, sources?.messages_inbound, period.endIso);
          const outboundCount = (value: number) => observedCount(value, sources?.messages_outbound, period.endIso);
          const observed = isObservedBy(sources?.messages_inbound, period.endIso) || isObservedBy(sources?.messages_outbound, period.endIso);
          const emptyText = observed ? "Nenhuma mensagem neste período." : "Sem dado de mensagens neste período.";
          const peak = findPeak(data.by_hour);
          const queue = buildQueueState(data.queue, nowIso);
          const oldestRun = queue.runs.oldestMinutes === null ? "" : `, a mais antiga há ${formatCount(queue.runs.oldestMinutes)} min`;
          return (
            <>
              <div className="flex flex-wrap">
                <Stat label="Recebidas" value={formatCount(inboundCount(totals.inbound))} />
                <Stat label="das quais cliques em resposta rápida" value={formatCount(inboundCount(totals.inbound_clicks))} />
                <Stat label="Enviadas por automação" value={formatCount(outboundCount(totals.outbound_automation))} />
                <Stat label="Enviadas pelo Inbox" value={formatCount(outboundCount(totals.outbound_manual))} />
                <Stat label="Pico" value={peak ? `${formatPeakHour(peak.hour)}, ${plural(peak.total, "mensagem", "mensagens")}` : NO_BASE_LABEL} />
              </div>

              <SubHeading>Por dia</SubHeading>
              {data.by_day.length === 0 ? (
                <Empty>{emptyText}</Empty>
              ) : (
                <MetricTable columns={[{ label: "Dia" }, ...FLOW_COLUMNS]} rows={[...data.by_day].reverse().map((row) => ({ key: row.day, cells: [shortDay(row.day), ...flowCells(row)] }))} />
              )}

              <SubHeading>Por perfil</SubHeading>
              {data.by_account.length === 0 ? (
                <Empty>{emptyText}</Empty>
              ) : (
                <MetricTable
                  columns={[{ label: "Perfil" }, ...FLOW_COLUMNS]}
                  rows={data.by_account.map((row) => ({ key: row.social_account_id, cells: [accountLabel(row.social_account_id, names), ...flowCells(row)] }))}
                />
              )}

              <SubHeading>Por automação</SubHeading>
              {data.by_automation.length === 0 ? (
                <Empty>Nenhum envio vinculado a automação neste período.</Empty>
              ) : (
                <MetricTable
                  columns={[{ label: "Automação" }, { label: "Situação" }, { label: "Enviadas", numeric: true }]}
                  rows={data.by_automation.map((row) => ({
                    key: row.automation_id,
                    cells: [displayName(row.name), row.status === "active" ? "ativa" : "inativa", formatCount(row.outbound)],
                  }))}
                />
              )}
              <PanelNote>{`Sem vínculo com automação: ${formatCount(data.outbound_automation_unlinked)}`}</PanelNote>

              <SubHeading>Fila agora, sem depender do período</SubHeading>
              <ul className="flex flex-col gap-1 px-5 pb-4 text-sm text-text-secondary">
                <li>
                  {queue.messageQueue.kind === "not_recorded"
                    ? "Fila de mensagens não registrada. O envio é direto e não grava esse estado."
                    : `Fila de mensagens: ${formatCount(queue.messageQueue.count)}${queue.messageQueue.oldestMinutes === null ? "" : `, a mais antiga há ${formatCount(queue.messageQueue.oldestMinutes)} min`}`}
                </li>
                <li>{`Execuções em espera: ${formatCount(queue.runs.delay)} por tempo, ${formatCount(queue.runs.retry)} para nova tentativa${oldestRun}`}</li>
                <li>{`Aguardando clique da pessoa: ${formatCount(queue.awaitingPerson)}`}</li>
              </ul>
              <PanelNote>Mensagens enviadas pelo app do Instagram não são capturadas.</PanelNote>
            </>
          );
        }}
      </BlockGate>
    </DetailPanel>
  );
}

/* ---------- Tempo de resposta ---------- */

function percentiles(d: Distribution): string {
  return `mediana ${formatDuration(d.p50)} · p95 ${formatDuration(d.p95)}`;
}

export function ResponseTimeSection({ result, names }: { result: RpcResult<RawResponseTimes>; names: Names }) {
  return (
    <DetailPanel id="tempo" title="Tempo de resposta" caption="Latência interna, por perfil, e primeira resposta humana.">
      <BlockGate result={result}>
        {(data) => {
          const internal = toDistribution(data.internal.samples, data.internal.p50_seconds, data.internal.p95_seconds);
          const human = toDistribution(data.human.answered, data.human.p50_seconds, data.human.p95_seconds);
          const answerRate = rate(data.human.answered, data.human.conversations_with_inbound);
          return (
            <>
              <ul className="divide-y divide-border-subtle">
                <MetricRow label="Comentário até primeira DM" value={COMMENT_TIME_UNAVAILABLE} />
                <MetricRow label="Gravação do comentário até primeira DM (latência interna)" detail={plural(internal.samples, "amostra", "amostras")} value={percentiles(internal)} />
              </ul>
              {data.internal_by_account.length > 0 && (
                <>
                  <SubHeading>Latência interna por perfil</SubHeading>
                  <MetricTable
                    columns={[{ label: "Perfil" }, { label: "Mediana", numeric: true }, { label: "p95", numeric: true }, { label: "Amostras", numeric: true }]}
                    rows={data.internal_by_account.map((row) => {
                      const distribution = toDistribution(row.samples, row.p50_seconds, row.p95_seconds);
                      return {
                        key: row.social_account_id,
                        cells: [accountLabel(row.social_account_id, names), formatDuration(distribution.p50), formatDuration(distribution.p95), formatCount(distribution.samples)],
                      };
                    })}
                  />
                </>
              )}
              <ul className="border-t border-border-subtle">
                <MetricRow
                  label="Primeira resposta humana"
                  detail={`${formatCount(data.human.answered)} respondidas de ${formatCount(data.human.conversations_with_inbound)}, taxa ${formatRate(answerRate)}`}
                  value={percentiles(human)}
                />
              </ul>
              <PanelNote>Cobre só respostas enviadas pelo Inbox do PITCHAT.</PanelNote>
            </>
          );
        }}
      </BlockGate>
    </DetailPanel>
  );
}

/* ---------- Saúde ---------- */

export function FailuresSection({
  result,
  runHref,
  period,
  sources,
  nowIso,
}: {
  result: RpcResult<RawFailures>;
  runHref: (short: string) => string;
  period: MetricsPeriod;
  sources: Sources | null;
  nowIso: string;
}) {
  return (
    <DetailPanel id="falhas" title="Saúde das automações" caption="Falhas por nó, erros predominantes e incidentes. Execuções presas mostram o momento atual.">
      <BlockGate result={result}>
        {(data) => {
          const nodes = buildNodeFailures(data.by_node);
          const errors = groupErrors(data.errors);
          const incidents = buildIncidents(data.incidents);
          const incidentsTotal = data.failed_runs + data.stuck_runs;
          const inPeriod = (value: number) => observedCount(value, sources?.runs, period.endIso);
          const observed = isObservedBy(sources?.runs, period.endIso);
          const noRuns = "Sem dado de execução neste período.";
          return (
            <>
              <div className="flex flex-wrap">
                <Stat label="Execuções no período" value={formatCount(inPeriod(data.runs_in_period))} />
                <Stat label="Falhas definitivas" value={formatCount(inPeriod(data.failed_runs))} color={data.failed_runs > 0 ? "var(--danger)" : undefined} />
                <Stat label="Tentativas que falharam e seguiram" value={formatCount(inPeriod(data.retry_attempts))} />
                <Stat label="Execuções presas agora" value={formatCount(observedCount(data.stuck_runs, sources?.runs, nowIso))} color={data.stuck_runs > 0 ? "var(--warning)" : undefined} />
                <Stat label="Falhas sem etapa registrada" value={formatCount(inPeriod(data.failed_without_step))} />
              </div>

              <SubHeading>Falha por nó</SubHeading>
              {nodes.length === 0 ? (
                <Empty>{observed ? "Nenhuma falha definitiva com etapa registrada neste período." : noRuns}</Empty>
              ) : (
                <MetricTable
                  columns={[{ label: "Automação" }, { label: "Nó" }, { label: "Falhas", numeric: true }, { label: "Passaram pelo nó", numeric: true }, { label: "Taxa", numeric: true }]}
                  rows={nodes.map((node) => ({
                    key: `${node.automationId}-${node.nodeId}`,
                    cells: [displayName(node.automationName), node.nodeLabel, formatCount(node.failures), formatCount(node.reached), formatRate(node.rate)],
                  }))}
                />
              )}

              <SubHeading>Erros predominantes</SubHeading>
              {errors.length === 0 ? (
                <Empty>{observed ? "Nenhuma causa de erro registrada neste período." : noRuns}</Empty>
              ) : (
                <ul className="divide-y divide-border-subtle border-t border-border-subtle">
                  {errors.map((error) => (
                    <MetricRow key={error.cause} label={error.cause} value={plural(error.failures, "falha", "falhas")} />
                  ))}
                </ul>
              )}

              <SubHeading>Incidentes</SubHeading>
              {incidents.length === 0 ? (
                <Empty>{observed ? "Nenhum incidente neste período." : noRuns}</Empty>
              ) : (
                <MetricTable
                  wide
                  columns={[{ label: "Quando" }, { label: "Execução" }, { label: "Automação" }, { label: "Nó" }, { label: "Causa" }]}
                  rows={incidents.map((incident) => ({
                    key: `${incident.runShort}-${incident.at}`,
                    cells: [
                      <span key="at" className="whitespace-nowrap">
                        {formatDateTime(incident.at)}
                      </span>,
                      <Link key="run" href={runHref(incident.runShort)} className="whitespace-nowrap font-mono text-xs underline hover:text-text">
                        run {incident.runShort}
                      </Link>,
                      `${displayName(incident.automationName)}${incident.automationInactive ? " (inativa)" : ""}`,
                      incident.nodeLabel ?? "sem etapa registrada",
                      incident.cause,
                    ],
                  }))}
                />
              )}
              {incidents.length > 0 && incidents.length < incidentsTotal && <PanelNote>{`Mostrando ${formatCount(incidents.length)} de ${formatCount(incidentsTotal)} incidentes, os mais recentes.`}</PanelNote>}
            </>
          );
        }}
      </BlockGate>
    </DetailPanel>
  );
}

/* ---------- Chance de viralizar ---------- */

export function ViralSection({ result, names, postsUnlinked }: { result: RpcResult<RawViral>; names: Names; postsUnlinked: number | null }) {
  return (
    <SectionPanel id="viralizar" title="Chance de viralizar" caption="Histórico insuficiente. Sem previsão em porcentagem. Não depende do período escolhido.">
      <BlockGate result={result} timeoutMessage={TIMEOUT_RETRY}>
        {(data) => {
          const accounts = buildViralAccounts(data.accounts);
          const goalPosts = buildGoalPosts(data.top_posts);
          return (
            <>
              {accounts.length === 0 ? (
                <Empty>Nenhuma conta conectada neste filtro.</Empty>
              ) : (
                <ul className="flex flex-col gap-4 px-5 py-4">
                  {accounts.map((account) => (
                    <li key={account.accountId}>
                      <div className="mb-1.5 flex flex-wrap justify-between gap-x-3 text-sm">
                        <span className="truncate text-text-secondary">{account.username ? `@${account.username}` : accountLabel(account.accountId, names)}</span>
                        <span className="tabular-nums text-text">{`${formatCount(account.mature)} de ${formatCount(account.target)} reels maduros publicados pelo PITCHAT`}</span>
                      </div>
                      <ProgressBar progress={account.progress} />
                      {account.status === "waiting_real_time" && <p className="mt-1 text-xs text-text-muted">Base completa. Falta o horário real do comentário.</p>}
                    </li>
                  ))}
                </ul>
              )}

              <SubHeading>Meta de pedidos por post, em todo o histórico</SubHeading>
              {goalPosts.length === 0 ? (
                <Empty>Nenhum pedido único registrado ainda.</Empty>
              ) : (
                <ul className="flex flex-col gap-4 px-5 pb-4 pt-2">
                  {goalPosts.map((post) => {
                    const label = `${accountLabel(post.accountId, names)}, post ${post.mediaId.slice(-5)}`;
                    return (
                      <li key={`${post.accountId}-${post.mediaId}`}>
                        <div className="mb-1.5 flex flex-wrap justify-between gap-x-3 text-sm">
                          {post.permalink ? (
                            <a href={post.permalink} target="_blank" rel="noreferrer" className="truncate text-text-secondary underline hover:text-text">
                              {label}
                            </a>
                          ) : (
                            <span className="truncate text-text-secondary">{label}</span>
                          )}
                          <span className="tabular-nums text-text">{`${formatCount(post.requests)} de ${formatCount(GOAL_PER_POST)} pedidos únicos`}</span>
                        </div>
                        <ProgressBar progress={post.progress} />
                      </li>
                    );
                  })}
                </ul>
              )}
              <PanelNote>{`Sinal definido: ${VIRAL_SIGNAL_MULTIPLIER}x a mediana do perfil na mesma idade. Calculado só quando houver base e horário real. Atualizado a cada 5 minutos.`}</PanelNote>
              {postsUnlinked !== null && postsUnlinked > 0 && <PanelNote>{`Reels publicados fora do PITCHAT não entram no progresso. ${plural(postsUnlinked, "post com comentários no período escolhido está", "posts com comentários no período escolhido estão")} sem vínculo com agendamento.`}</PanelNote>}
            </>
          );
        }}
      </BlockGate>
    </SectionPanel>
  );
}

/* ---------- Próximas fases ---------- */

export function NextPhasesSection() {
  return (
    <SectionPanel id="proximas" title="Próximas fases">
      <ul className="divide-y divide-border-subtle">
        <MetricRow label="Clique em link" value="rastreio ainda não ativo" />
        <MetricRow label="Views, alcance e salvos" value="precisa da permissão de insights da Meta" />
        <MetricRow label="Aula, play e venda" value="integração não conectada" />
      </ul>
    </SectionPanel>
  );
}
