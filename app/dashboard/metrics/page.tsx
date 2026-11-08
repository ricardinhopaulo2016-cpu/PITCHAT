import Link from "next/link";
import { redirect } from "next/navigation";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/app-shell/page-header";
import { getAuthContext } from "@/lib/auth/session";
import { listWorkspaceChannelAccounts, normalizeChannelParam, resolveChannel } from "@/lib/channel/repo";
import { buildHref, withChannelQuery, withoutChannelParam } from "@/lib/channel/url";
import { readWindow } from "@/lib/metrics/daily";
import { buildNodeFailures, parseRunParam } from "@/lib/metrics/failures";
import { buildQueueState, findPeak, hourStats } from "@/lib/metrics/flow";
import { sumFunnel } from "@/lib/metrics/funnel";
import { buildInsights, type Insight } from "@/lib/metrics/insights";
import { comparisonWindows, resolvePeriod, type ComparisonWindow, type MetricsPeriod } from "@/lib/metrics/period";
import { loadMetricsData, type MetricsData } from "@/lib/metrics/repo";
import { toDistribution } from "@/lib/metrics/response-time";
import { hasMissing, mostlyFailed, resultData } from "@/lib/metrics/rpc";
import { buildGoalPosts } from "@/lib/metrics/viral";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  ConfidenceSection,
  EvolutionSection,
  FailuresSection,
  FlowSection,
  FunnelSection,
  InsightsSection,
  NextPhasesSection,
  ResponseTimeSection,
  RunIncidentSection,
  ViralSection,
} from "./sections";

export const dynamic = "force-dynamic"; // sempre dado real e atual, nunca cacheado

const PATH = "/dashboard/metrics";

function insightsFrom(data: MetricsData, period: MetricsPeriod, windows: ComparisonWindow[], now: Date): Insight[] {
  const funnel = resultData(data.funnel);
  const failures = resultData(data.failures);
  const flow = resultData(data.flow);
  const responseTimes = resultData(data.responseTimes);
  const confidence = resultData(data.confidence);
  const viral = resultData(data.viral);
  const sources = confidence?.sources ?? null;

  const requestsIn = (key: "today" | "yesterday_same_time") => {
    const window = windows.find((w) => w.key === key);
    if (!window) return null;
    const reading = readWindow("request_unique", resultData(data.windows[key]), window, sources);
    return reading.coverage === "complete" ? reading.value : null;
  };
  const stats = flow ? hourStats(flow.by_hour) : { activeHours: 0, averageHourly: null };

  return buildInsights({
    periodLabel: period.label,
    now,
    funnel: funnel ? sumFunnel(funnel.by_account) : null,
    failures: failures ? { failedRuns: failures.failed_runs, topNode: buildNodeFailures(failures.by_node)[0] ?? null } : null,
    internalLatency: responseTimes
      ? toDistribution(responseTimes.internal.samples, responseTimes.internal.p50_seconds, responseTimes.internal.p95_seconds)
      : null,
    peak: flow ? findPeak(flow.by_hour) : null,
    activeHours: stats.activeHours,
    averageHourly: stats.averageHourly,
    queue: flow ? buildQueueState(flow.queue, now.toISOString()) : null,
    postsUnlinked: confidence?.posts_unlinked ?? null,
    todayRequests: requestsIn("today"),
    yesterdaySameTimeRequests: requestsIn("yesterday_same_time"),
    bestGoalPost: viral ? (buildGoalPosts(viral.top_posts)[0] ?? null) : null,
  });
}

export default async function MetricsPage({
  searchParams,
}: {
  searchParams: Promise<{ channel?: string; de?: string; ate?: string; run?: string }>;
}) {
  const params = await searchParams;
  const { channel: rawChannel, de, ate, run } = params;

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  if (rawChannel === "all") redirect(withoutChannelParam(PATH, params));

  const channelId = normalizeChannelParam(rawChannel);
  const channel = channelId ? await resolveChannel(admin, auth.workspace.id, channelId) : null;

  if (channelId && !channel) {
    return (
      <>
        <PageHeader title="Métricas" description="Dados reais da operação no Instagram." />
        <div className="px-6 pb-10 md:px-11">
          <EmptyState
            title="Canal não encontrado ou não está mais conectado."
            description="A conta selecionada não existe mais neste workspace, ou foi desconectada. Nenhum dado foi ampliado pra outro canal automaticamente."
            action={
              <Link
                href={withoutChannelParam(PATH, params)}
                className="inline-flex h-11 items-center justify-center rounded-[var(--radius-button)] bg-signal px-3.5 text-sm font-medium text-signal-on transition-colors duration-[var(--motion-fast)] hover:bg-signal-hover"
              >
                Ver todos os canais
              </Link>
            }
          />
        </div>
      </>
    );
  }

  const now = new Date();
  const period = resolvePeriod(de, ate, now);
  const windows = comparisonWindows(now);
  const runPrefix = parseRunParam(run);

  const [data, accounts] = await Promise.all([
    loadMetricsData(admin, { workspaceId: auth.workspace.id, accountId: channel?.id ?? null, period, windows, runPrefix, now }),
    listWorkspaceChannelAccounts(admin, auth.workspace.id),
  ]);

  const names = new Map(accounts.map((a) => [a.id, `@${a.username ?? "conta"}`]));
  const scope = channel ? `@${channel.username ?? "conta"}` : "todos os perfis";
  const confidence = resultData(data.confidence);
  const sources = confidence?.sources ?? null;
  const postsUnlinked = confidence?.posts_unlinked ?? null;

  const blocks = [data.daily, ...Object.values(data.windows), data.confidence, data.funnel, data.flow, data.responseTimes, data.failures, data.viral];
  const missing = hasMissing(data.runIncident ? [...blocks, data.runIncident] : blocks);

  const insightSources = [data.funnel, data.failures, data.flow, data.responseTimes, data.confidence, data.viral, data.windows.today, data.windows.yesterday_same_time];
  const insights = mostlyFailed(insightSources) ? null : insightsFrom(data, period, windows, now);

  const runHref = (short: string) => `${buildHref(PATH, { channel: channel?.id, de, ate, run: short })}#incidente`;

  return (
    <>
      <PageHeader
        title="Métricas"
        description={`Dados reais de ${scope}, ${period.label}. Dias em horário de Brasília.${period.clamped ? " Período limitado a 92 dias." : ""}`}
        action={<DateRangeFilter emptyLabel="Últimos 7 dias" />}
      />

      <div className="flex flex-col gap-6 px-6 pb-14 md:px-11">
        {missing && (
          <EmptyState
            title="Parte das métricas ainda não está disponível"
            description="A atualização do banco desta tela ainda não foi aplicada. O restante do PITCHAT segue funcionando normalmente."
          />
        )}

        {run && <RunIncidentSection prefix={runPrefix} result={data.runIncident} names={names} />}
        <ConfidenceSection result={data.confidence} period={period} />
        <InsightsSection insights={insights} healthHref={withChannelQuery("/dashboard/health", channel?.id ?? null)} />
        <EvolutionSection daily={data.daily} windows={data.windows} windowList={windows} period={period} sources={sources} now={now} postsUnlinked={postsUnlinked} />
        <FunnelSection result={data.funnel} period={period} names={names} />
        <FlowSection result={data.flow} names={names} nowIso={now.toISOString()} period={period} sources={sources} />
        <ResponseTimeSection result={data.responseTimes} names={names} />
        <FailuresSection result={data.failures} runHref={runHref} period={period} sources={sources} nowIso={now.toISOString()} />
        <ViralSection result={data.viral} names={names} postsUnlinked={postsUnlinked} />
        <NextPhasesSection />
      </div>
    </>
  );
}
