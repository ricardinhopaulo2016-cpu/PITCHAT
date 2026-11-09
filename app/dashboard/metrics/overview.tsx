import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { SignalMarker } from "@/components/icons/pitchat";
import { SectionPanel } from "@/components/ui/section-panel";
import { GOAL_PHRASE, NO_BASE_LABEL } from "@/lib/metrics/constants";
import { funnelVerdict, lossHint, nodeVerdict, worstFunnelLoss, type FunnelLoss, type FunnelVerdict, type NodeVerdict } from "@/lib/metrics/bottleneck";
import { buildDailySeries, failureCount, isObservedBy, observedCount, sumNullable, type DailyRow, type RawDaily, type Sources } from "@/lib/metrics/daily";
import type { RawFailures } from "@/lib/metrics/failures";
import { bucketTotal, hourOfDayProfile, type RawFlow } from "@/lib/metrics/flow";
import { buildFunnel, sumFunnel, type Funnel, type FunnelCounts, type FunnelStage, type RawFunnel } from "@/lib/metrics/funnel";
import type { Kpi, KpiTrend } from "@/lib/metrics/overview";
import type { MetricsPeriod } from "@/lib/metrics/period";
import { displayName, formatCount, formatRate } from "@/lib/metrics/rates";
import type { RpcResult } from "@/lib/metrics/rpc";
import { todayKey } from "@/lib/ui/date-range";
import { DailyLineChart, HourColumns, type ChartSeries, type HourColumn } from "./charts";
import { accountLabel, BlockGate, Empty, PanelNote, plural, shortDay, type Names } from "./sections";

/* ---------- KPIs ---------- */

const TREND_STYLE: Record<KpiTrend, string> = { good: "text-success", bad: "text-danger", flat: "text-text-muted" };

function TrendIcon({ kpi }: { kpi: Kpi }) {
  if (kpi.trend === null) return null;
  const className = `h-3.5 w-3.5 shrink-0 ${TREND_STYLE[kpi.trend]}`;
  if (kpi.trend === "flat") return <Minus aria-hidden="true" className={className} />;
  return kpi.deltaText.startsWith("+") ? <ArrowUpRight aria-hidden="true" className={className} /> : <ArrowDownRight aria-hidden="true" className={className} />;
}

function KpiCard({ kpi }: { kpi: Kpi }) {
  return (
    <li className={`flex min-w-0 flex-col gap-1 rounded-[var(--radius-panel-lg)] border bg-surface-1 px-4 py-3.5 ${kpi.alert ? "border-danger/50" : "border-border-subtle"}`}>
      <span className="text-xs text-text-muted">{kpi.label}</span>
      <span className={kpi.hasValue ? `text-[26px] font-semibold leading-tight tracking-[-0.02em] ${kpi.alert ? "text-danger" : "text-text"}` : "py-1.5 text-base text-text-muted"}>{kpi.display}</span>
      {kpi.caption && <span className="text-xs text-text-muted">{kpi.caption}</span>}
      <span className="mt-auto flex items-center gap-1 pt-1 text-xs text-text-secondary">
        <TrendIcon kpi={kpi} />
        {kpi.trend === null ? <span className="text-text-muted">{NO_BASE_LABEL} para comparar</span> : <span>{`${kpi.deltaText}${kpi.baseline === null ? "" : `, antes ${kpi.baseline}`}`}</span>}
      </span>
    </li>
  );
}

export function KpiGrid({ kpis, comparisonLabel }: { kpis: Kpi[]; comparisonLabel: string }) {
  return (
    <section aria-label="Indicadores do período" className="flex flex-col gap-2">
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.key} kpi={kpi} />
        ))}
      </ul>
      <p className="text-xs text-text-muted">Variação contra {comparisonLabel}.</p>
    </section>
  );
}

/* ---------- Gargalo ---------- */

type BottleneckTone = "danger" | "success" | "muted";

function BottleneckCard({ title, tone, children }: { title: string; tone: BottleneckTone; children: ReactNode }) {
  const rail = { danger: "bg-danger", success: "bg-success", muted: "bg-border-strong" }[tone];
  return (
    <div className="relative min-w-0 py-4 pl-6 pr-5">
      <span aria-hidden="true" className={`absolute inset-y-4 left-3 w-0.5 rounded-full ${rail}`} />
      <p className="text-xs text-text-muted">{title}</p>
      {children}
    </div>
  );
}

function BigLine({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 text-xl font-semibold leading-snug text-text">{children}</p>;
}

const FUNNEL_TONE: Record<FunnelVerdict["kind"], BottleneckTone> = { no_base: "muted", no_loss: "success", loss: "danger" };

function FunnelVerdictText({ verdict }: { verdict: FunnelVerdict }) {
  if (verdict.kind === "no_base") return <p className="mt-1 text-sm text-text-muted">Sem pedidos neste período, então {NO_BASE_LABEL} para apontar perda.</p>;
  if (verdict.kind === "no_loss") return <p className="mt-1 text-sm text-text-secondary">Nenhuma perda entre pedido, execução, DM e botão neste período.</p>;
  const { loss } = verdict;
  return (
    <>
      <BigLine>{plural(loss.lost, "pessoa ficou pelo caminho", "pessoas ficaram pelo caminho")}</BigLine>
      <p className="mt-1 text-sm text-text-secondary">
        Entre {loss.from.label} ({formatCount(loss.from.count)}) e {loss.to.label} ({formatCount(loss.to.count)}). Passagem: {loss.to.rate ? formatRate(loss.to.rate) : NO_BASE_LABEL}.
      </p>
      <p className="mt-1 text-xs text-text-muted">{lossHint(loss)}</p>
    </>
  );
}

function FunnelLossCard({ result }: { result: RpcResult<RawFunnel> }) {
  const verdict = result.status === "ok" ? funnelVerdict(result.data.by_account) : null;
  return (
    <BottleneckCard title="Onde mais se perde gente" tone={verdict ? FUNNEL_TONE[verdict.kind] : "muted"}>
      <BlockGate result={result}>{() => verdict && <FunnelVerdictText verdict={verdict} />}</BlockGate>
    </BottleneckCard>
  );
}

const NODE_TONE: Record<NodeVerdict["kind"], BottleneckTone> = { node: "danger", without_step: "danger", healthy: "success", no_base: "muted" };

function NodeVerdictText({ verdict, runHref }: { verdict: NodeVerdict; runHref: (short: string) => string }) {
  if (verdict.kind === "no_base") return <p className="mt-1 text-sm text-text-secondary">{`Sem dado de execução neste período, ${NO_BASE_LABEL}.`}</p>;
  if (verdict.kind === "healthy") return <p className="mt-1 text-sm text-text-secondary">Nenhuma falha definitiva neste período.</p>;
  if (verdict.kind === "without_step") {
    return (
      <>
        <BigLine>{plural(verdict.failures, "falha sem etapa registrada", "falhas sem etapa registrada")}</BigLine>
        <p className="mt-1 text-sm text-text-secondary">A última etapa dessas execuções não registrou erro, então não dá para apontar o nó.</p>
        <a href="#falhas" className="mt-1 inline-block text-sm text-text underline hover:text-signal">
          Ver saúde das automações
        </a>
      </>
    );
  }
  const { node, cause, incident } = verdict.top;
  return (
    <>
      <BigLine>{`${plural(node.failures, "falha", "falhas")} em ${node.nodeLabel}`}</BigLine>
      <p className="mt-1 text-sm text-text-secondary">
        Automação {displayName(node.automationName)}. {`${formatCount(node.failures)} de ${formatCount(node.reached)} execuções que passaram pelo nó (${formatRate(node.rate)}).`}
      </p>
      <p className="mt-1 text-sm text-text-secondary">Causa: {cause ?? "fora dos incidentes mais recentes listados."}</p>
      {incident ? (
        <Link href={runHref(incident.runShort)} className="mt-1 inline-block text-sm text-text underline hover:text-signal">
          Abrir incidente run {incident.runShort}
        </Link>
      ) : (
        <a href="#falhas" className="mt-1 inline-block text-sm text-text underline hover:text-signal">
          Ver saúde das automações
        </a>
      )}
    </>
  );
}

function NodeFailureCard({ result, period, sources, runHref }: { result: RpcResult<RawFailures>; period: MetricsPeriod; sources: Sources | null; runHref: (short: string) => string }) {
  const verdict = result.status === "ok" ? nodeVerdict(result.data, isObservedBy(sources?.runs, period.endIso)) : null;
  return (
    <BottleneckCard title="Nó de automação que mais falha" tone={verdict ? NODE_TONE[verdict.kind] : "muted"}>
      <BlockGate result={result}>{() => verdict && <NodeVerdictText verdict={verdict} runHref={runHref} />}</BlockGate>
    </BottleneckCard>
  );
}

export function BottleneckPanel({
  funnel,
  failures,
  period,
  sources,
  nowIso,
  runHref,
}: {
  funnel: RpcResult<RawFunnel>;
  failures: RpcResult<RawFailures>;
  period: MetricsPeriod;
  sources: Sources | null;
  nowIso: string;
  runHref: (short: string) => string;
}) {
  const stuck = failures.status === "ok" ? observedCount(failures.data.stuck_runs, sources?.runs, nowIso) : null;
  return (
    <SectionPanel id="gargalo" title="Gargalo" caption={`A maior perda ${period.label}.`}>
      <div className="grid divide-y divide-border-subtle md:grid-cols-2 md:divide-x md:divide-y-0">
        <FunnelLossCard result={funnel} />
        <NodeFailureCard result={failures} period={period} sources={sources} runHref={runHref} />
      </div>
      {stuck !== null && stuck > 0 && (
        <p className="flex items-center gap-2 border-t border-border-subtle px-5 py-2.5 text-sm text-text-secondary">
          <SignalMarker type="logic" style={{ color: "var(--warning)" }} />
          {`${plural(stuck, "execução presa", "execuções presas")} agora, independente do período.`}
          <a href="#falhas" className="underline hover:text-text">
            Ver
          </a>
        </p>
      )}
    </SectionPanel>
  );
}

/* ---------- Funil visual ---------- */

function passageText(stage: FunnelStage, previous: FunnelStage): string {
  if (!stage.rate) return "";
  if (stage.rate.kind === "no_base") return formatRate(stage.rate);
  const rateText = stage.rate.kind === "value" ? `${formatRate(stage.rate)} ${stage.rateCaption}` : formatRate(stage.rate);
  if (stage.key === "requests") return `${rateText}, triagem pela frase, não conta como perda`;
  const lost = previous.count - stage.count;
  return lost > 0 ? `${rateText}, ${formatCount(lost)} a menos` : rateText;
}

function FunnelRows({ funnel, worst }: { funnel: Funnel; worst: FunnelLoss | null }) {
  const max = Math.max(...funnel.stages.map((stage) => stage.count), 1);
  return (
    <ol className="flex flex-col gap-1 px-5 py-4" aria-label="Funil do comentário até a mensagem com botão">
      {funnel.stages.map((stage, index) => {
        const previous = funnel.stages[index - 1];
        const isWorst = worst?.to.key === stage.key;
        const width = (stage.count / max) * 100;
        return (
          <li key={stage.key} className="flex flex-col">
            {previous && (
              <p className={`flex items-start gap-1.5 py-1.5 pl-3 text-xs ${isWorst ? "text-text" : "text-text-muted"}`}>
                {isWorst ? <SignalMarker type="error" className="mt-0.5 shrink-0" style={{ color: "var(--danger)" }} /> : <span aria-hidden="true" className="mt-0.5 h-3 w-px shrink-0 bg-border-strong" />}
                <span className="min-w-0">
                  {passageText(stage, previous)}
                  {isWorst && <span className="ml-1.5 inline-block rounded-[6px] bg-danger-soft px-1.5 font-medium text-danger">Maior perda</span>}
                </span>
              </p>
            )}
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-text-secondary">{stage.label}</span>
              <span className="font-semibold tabular-nums text-text">{formatCount(stage.count)}</span>
            </div>
            <div className="mt-1 h-3 rounded-[4px] bg-surface-3">{stage.count > 0 && <div className={`h-3 min-w-1 rounded-[4px] ${isWorst ? "bg-danger" : "bg-signal"}`} style={{ width: `${width}%` }} />}</div>
          </li>
        );
      })}
    </ol>
  );
}

export function FunnelPanel({ result, period }: { result: RpcResult<RawFunnel>; period: MetricsPeriod }) {
  return (
    <SectionPanel id="funil-visual" title="Funil operacional" caption={`Por pessoa e post, ${period.label}. Inclui automações inativas.`}>
      <BlockGate result={result}>
        {(data) => {
          if (data.by_account.length === 0) return <Empty>Nenhum comentário válido recebido pelo PITCHAT neste período.</Empty>;
          const funnel = buildFunnel(sumFunnel(data.by_account));
          return (
            <>
              <FunnelRows funnel={funnel} worst={worstFunnelLoss(funnel)} />
              <p className="border-t border-border-subtle px-5 py-3 text-xs text-text-muted">{`Botão: ${formatCount(funnel.linkButton)} com link, ${formatCount(funnel.quickReplyButton)} com resposta rápida.`}</p>
              {funnel.pendingExecution > 0 && (
                <p className="border-t border-border-subtle px-5 py-3 text-sm text-warning">
                  {plural(funnel.pendingExecution, "pedido sem execução", "pedidos sem execução")}. Motivo não registrado: pode ser automação inativa, palavra-chave diferente, atendimento humano ou queda do processamento.
                </p>
              )}
              {funnel.requestsWithoutAuthor > 0 && <PanelNote>{plural(funnel.requestsWithoutAuthor, "pedido sem autor identificado ficou", "pedidos sem autor identificado ficaram")} fora dos únicos.</PanelNote>}
              <PanelNote>Pedido é um comentário que contém {GOAL_PHRASE}, sem contar acento, pontuação ou maiúscula. Comentários válidos contam cada comentário; pedidos únicos contam pessoas por post.</PanelNote>
            </>
          );
        }}
      </BlockGate>
    </SectionPanel>
  );
}

/* ---------- Evolução e horas ---------- */

const DAY_NUMBERS: { label: string; read: (row: DailyRow) => number | null; alert?: boolean }[] = [
  { label: "Comentários", read: (row) => row.values.comment_valid },
  { label: "Pedidos únicos", read: (row) => row.values.request_unique },
  { label: "Disparos", read: (row) => row.values.run_started },
  { label: "DMs (automação)", read: (row) => row.values.dm_automation },
  { label: "DMs (Inbox)", read: (row) => row.values.dm_manual },
  { label: "Falhas", read: (row) => failureCount(row.values), alert: true },
];

/** Um dia só não é linha: em vez de um ponto solto, mostra o dia em barras. */
function DayNumbers({ row }: { row: DailyRow }) {
  const values = DAY_NUMBERS.map((item) => item.read(row));
  const max = Math.max(1, ...values.map((value) => value ?? 0));
  return (
    <ul className="flex flex-col gap-3 px-5 py-4">
      {DAY_NUMBERS.map((item, index) => {
        const value = values[index];
        return (
          <li key={item.label}>
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-text-secondary">{item.label}</span>
              <span className={value === null ? "text-text-muted" : "font-semibold tabular-nums text-text"}>{value === null ? NO_BASE_LABEL : formatCount(value)}</span>
            </div>
            <div className="mt-1 h-2 rounded-[4px] bg-surface-3">{value !== null && value > 0 && <div className={`h-2 min-w-1 rounded-[4px] ${item.alert ? "bg-danger" : "bg-info"}`} style={{ width: `${(value / max) * 100}%` }} />}</div>
          </li>
        );
      })}
    </ul>
  );
}

function evolutionSeries(rows: DailyRow[]): ChartSeries[] {
  return [
    { key: "requests", label: "Pedidos únicos", color: "var(--signal)", values: rows.map((row) => row.values.request_unique) },
    { key: "dms", label: "DMs enviadas", color: "var(--info)", values: rows.map((row) => sumNullable(row.values.dm_automation, row.values.dm_manual)) },
    { key: "failures", label: "Falhas", color: "var(--danger)", values: rows.map((row) => failureCount(row.values)) },
  ];
}

function describeSeries(series: ChartSeries[], days: string[]): string {
  const parts = series.map((item) => {
    const known = item.values.filter((value): value is number => value !== null);
    return known.length === 0 ? `${item.label}: ${NO_BASE_LABEL}` : `${item.label}: mínimo ${formatCount(Math.min(...known))}, máximo ${formatCount(Math.max(...known))}, último ${formatCount(known[known.length - 1])}`;
  });
  return `Evolução por dia de ${shortDay(days[0])} a ${shortDay(days[days.length - 1])}. ${parts.join(". ")}. Os valores de cada dia estão na tabela de detalhes.`;
}

export function EvolutionPanel({ daily, period, sources, now }: { daily: RpcResult<RawDaily[]>; period: MetricsPeriod; sources: Sources | null; now: Date }) {
  const single = period.days.length === 1;
  return (
    <SectionPanel id="evolucao-visual" title={single ? `Resumo do dia ${shortDay(period.days[0])}` : "Evolução por dia"} caption={single ? "Com um dia só, os números aparecem em barras. A distribuição por hora está no painel de mensagens." : `Por dia, ${period.label}.`}>
      <BlockGate result={daily}>
        {(raw) => {
          const rows = buildDailySeries(raw, period.days, sources, todayKey(now));
          if (single) {
            return (
              <>
                <DayNumbers row={rows[0]} />
                {rows[0].partial && <PanelNote>O dia ainda está em andamento.</PanelNote>}
              </>
            );
          }
          const series = evolutionSeries(rows);
          const hasData = series.some((item) => item.values.some((value) => (value ?? 0) > 0));
          if (!hasData) return <Empty>{series.every((item) => item.values.every((value) => value === null)) ? `Sem dado neste período, ${NO_BASE_LABEL}.` : "Nenhum pedido, DM ou falha neste período."}</Empty>;
          const lastIsPartial = rows[rows.length - 1].partial;
          return (
            <>
              <DailyLineChart days={period.days} series={series} lastIsPartial={lastIsPartial} description={describeSeries(series, period.days)} />
              <PanelNote>
                {lastIsPartial ? "O último dia ainda está em andamento, por isso o trecho final aparece apagado. " : ""}O dia de cada evento usa o horário real do comentário quando disponível.
              </PanelNote>
            </>
          );
        }}
      </BlockGate>
    </SectionPanel>
  );
}

function hourColumns(flow: RawFlow, period: MetricsPeriod, now: Date): HourColumn[] {
  const liveDay = period.days.length === 1 && period.days[0] === todayKey(now);
  const currentHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(now));
  return hourOfDayProfile(flow.by_hour).map((bucket) => ({ hourOfDay: bucket.hourOfDay, total: bucketTotal(bucket), future: liveDay && bucket.hourOfDay > currentHour }));
}

function nowSentence(columns: HourColumn[]): string {
  const firstFuture = columns.find((column) => column.future);
  return firstFuture ? ` Agora são ${String(firstFuture.hourOfDay - 1).padStart(2, "0")}h e as horas seguintes ainda não chegaram.` : "";
}

export function MessagesByHourPanel({ result, period, sources, now }: { result: RpcResult<RawFlow>; period: MetricsPeriod; sources: Sources | null; now: Date }) {
  const single = period.days.length === 1;
  return (
    <SectionPanel id="horas" title="Mensagens por hora" caption={single ? `Recebidas e enviadas, ${period.label}, em horário de Brasília.` : "Recebidas e enviadas, soma dos dias do período, em horário de Brasília."}>
      <BlockGate result={result}>
        {(data) => {
          const columns = hourColumns(data, period, now);
          const peak = Math.max(...columns.map((column) => column.total));
          if (peak === 0) {
            const observed = isObservedBy(sources?.messages_inbound, period.endIso) || isObservedBy(sources?.messages_outbound, period.endIso);
            return <Empty>{observed ? "Nenhuma mensagem neste período." : `Sem dado de mensagens neste período, ${NO_BASE_LABEL}.`}</Empty>;
          }
          const peakHour = columns.find((column) => column.total === peak)?.hourOfDay ?? 0;
          const peakLabel = `${String(peakHour).padStart(2, "0")}h`;
          return (
            <>
              <HourColumns columns={columns} description={`Mensagens por hora do dia. Pico às ${peakLabel}, com ${plural(peak, "mensagem", "mensagens")}.${nowSentence(columns)} Os valores de cada hora estão em "Ver valores por hora", logo abaixo do gráfico.`} />
              <PanelNote>{`Pico às ${peakLabel}: ${plural(peak, "mensagem", "mensagens")}${single ? "" : " somando os dias"}.`}</PanelNote>
            </>
          );
        }}
      </BlockGate>
    </SectionPanel>
  );
}

/* ---------- Por perfil e por post ---------- */

const RATE_STAGES: { key: FunnelStage["key"]; label: string }[] = [
  { key: "executions", label: "Execução" },
  { key: "first_dm", label: "1ª DM" },
  { key: "button", label: "Botão" },
];

function ComparisonRow({ label, href, counts, max, showBar }: { label: string; href: string | null; counts: FunnelCounts; max: number; showBar: boolean }) {
  const funnel = buildFunnel(counts);
  const worst = worstFunnelLoss(funnel);
  return (
    <li className="px-5 py-3">
      <div className="flex items-baseline justify-between gap-3">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="min-w-0 truncate text-sm text-text underline hover:text-signal">
            {label}
          </a>
        ) : (
          <span className="min-w-0 truncate text-sm text-text">{label}</span>
        )}
        <span className="shrink-0 text-sm text-text-secondary">
          <span className="font-semibold tabular-nums text-text">{formatCount(counts.requests_unique)}</span> {counts.requests_unique === 1 ? "pedido" : "pedidos"}
        </span>
      </div>
      {showBar && <div className="mt-1.5 h-2 rounded-[4px] bg-surface-3">{counts.requests_unique > 0 && <div className="h-2 min-w-1 rounded-[4px] bg-signal" style={{ width: `${(counts.requests_unique / max) * 100}%` }} />}</div>}
      <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {RATE_STAGES.map(({ key, label: stageLabel }) => {
          const stage = funnel.stages.find((item) => item.key === key);
          const isWorst = worst?.to.key === key;
          return (
            <li key={key} className="flex items-center gap-1">
              {isWorst && <SignalMarker type="error" style={{ color: "var(--danger)" }} />}
              <span>{stageLabel}</span>
              <span className={`tabular-nums ${isWorst ? "font-medium text-text" : "text-text-secondary"}`}>{stage?.rate ? formatRate(stage.rate) : NO_BASE_LABEL}</span>
              {isWorst && <span className="text-text-secondary">maior perda</span>}
            </li>
          );
        })}
      </ul>
    </li>
  );
}

const TOP_POSTS_SHOWN = 8;

export function ComparisonPanels({ result, period, names }: { result: RpcResult<RawFunnel>; period: MetricsPeriod; names: Names }) {
  const empty = <Empty>Nenhum comentário válido recebido pelo PITCHAT neste período.</Empty>;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <SectionPanel id="por-perfil" title="Por perfil" caption={`Pedidos únicos e passagem entre etapas, ${period.label}.`}>
        <BlockGate result={result}>
          {(data) => {
            if (data.by_account.length === 0) return empty;
            const max = Math.max(1, ...data.by_account.map((row) => row.requests_unique));
            return (
              <ul className="divide-y divide-border-subtle">
                {data.by_account.map((row) => (
                  <ComparisonRow key={row.social_account_id} label={accountLabel(row.social_account_id, names)} href={null} counts={row} max={max} showBar={data.by_account.length > 1} />
                ))}
              </ul>
            );
          }}
        </BlockGate>
      </SectionPanel>
      <SectionPanel id="por-post" title="Por post" caption={`Os que mais pediram, ${period.label}.`}>
        <BlockGate result={result}>
          {(data) => {
            if (data.by_post.length === 0) return empty;
            const shown = data.by_post.slice(0, TOP_POSTS_SHOWN);
            const max = Math.max(1, ...shown.map((row) => row.requests_unique));
            return (
              <>
                <ul className="divide-y divide-border-subtle">
                  {shown.map((row) => (
                    <ComparisonRow key={`${row.social_account_id}-${row.external_media_id}`} label={`${accountLabel(row.social_account_id, names)}, post ${row.external_media_id.slice(-5)}`} href={row.permalink} counts={row} max={max} showBar={shown.length > 1} />
                  ))}
                </ul>
                {data.posts_total > shown.length && <PanelNote>{`Mostrando ${formatCount(shown.length)} de ${formatCount(data.posts_total)} posts. A lista maior está nos detalhes.`}</PanelNote>}
              </>
            );
          }}
        </BlockGate>
      </SectionPanel>
    </div>
  );
}
