import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app-shell/page-header";
import { SignalMarker } from "@/components/icons/pitchat";
import {
  classifyWebhookHealth,
  classifyAutomationHealth,
  classifySocialAccountHealth,
  classifyTokenMaintenanceHealth,
  classifyQstashHealth,
  buildIncidentRail,
  type OperationalStatus,
  type WebhookEventRow,
  type AutomationRunRow,
  type SocialAccountRow,
  type JobRow,
} from "@/lib/health/aggregate";

export const dynamic = "force-dynamic"; // sempre dado real e atual, nunca cacheado

const WINDOWS = [
  { minutes: 15, label: "15 min" },
  { minutes: 60, label: "60 min" },
  { minutes: 1440, label: "24 h" },
] as const;
const DEFAULT_WINDOW_MINUTES = 60;

const STATUS_CONFIG: Record<OperationalStatus, { label: string; color: string; marker: "action" | "logic" | "error" }> = {
  operational: { label: "Operacional", color: "var(--success)", marker: "action" },
  attention: { label: "Atenção", color: "var(--warning)", marker: "logic" },
  incident: { label: "Incidente", color: "var(--danger)", marker: "error" },
};

const INCIDENT_MARKER: Record<"info" | "warning" | "incident", { marker: "action" | "logic" | "error"; color: string }> = {
  info: { marker: "action", color: "var(--text-secondary)" },
  warning: { marker: "logic", color: "var(--warning)" },
  incident: { marker: "error", color: "var(--danger)" },
};

function StatusRow({ label, status, reason }: { label: string; status: OperationalStatus; reason: string }) {
  const config = STATUS_CONFIG[status];
  return (
    <li className="flex items-center justify-between gap-4 px-5 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-text">{label}</p>
        <p className="truncate text-xs text-text-muted">{reason}</p>
      </div>
      <span className="inline-flex shrink-0 items-center gap-1.5 text-sm" style={{ color: config.color }}>
        <SignalMarker type={config.marker} width={10} height={10} style={{ color: config.color }} />
        {config.label}
      </span>
    </li>
  );
}

function Stat({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="flex flex-col gap-1 border-r border-border-subtle px-4 py-3 last:border-r-0">
      <span className="font-mono text-xl font-medium tabular-nums" style={{ color: color ?? "var(--text)" }}>
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-wide text-text-muted">{label}</span>
    </div>
  );
}

function SectionPanel({ title, children, caption }: { title: string; children: React.ReactNode; caption?: string }) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
      <div className="border-b border-border-subtle bg-surface-1 px-5 py-2.5">
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{title}</p>
        {caption && <p className="mt-0.5 text-xs text-text-muted">{caption}</p>}
      </div>
      {children}
    </div>
  );
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export default async function HealthDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string }>;
}) {
  const { window: windowParam } = await searchParams;
  const windowMinutes = WINDOWS.some((w) => String(w.minutes) === windowParam) ? Number(windowParam) : DEFAULT_WINDOW_MINUTES;

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const now = new Date();
  const nowIso = now.toISOString();
  const sinceIso = new Date(now.getTime() - windowMinutes * 60_000).toISOString();

  // 4 queries independentes, paralelizadas — teto de linhas em cada uma
  // (nunca "select * sem limite"). webhook_events não tem workspace_id no
  // schema hoje (achado da auditoria de 24/09/2026, já documentado como gap
  // conhecido) — mostrado sem filtro de workspace, sinalizado na legenda.
  const [{ data: webhookEvents }, { data: automationRuns }, { data: socialAccounts }, { data: jobs }] = await Promise.all([
    admin
      .from("webhook_events")
      .select("id, event_type, status, received_at, last_error")
      .gte("received_at", sinceIso)
      .order("received_at", { ascending: false })
      .limit(500)
      .returns<WebhookEventRow[]>(),
    admin
      .from("automation_runs")
      .select("id, status, waiting_reason, started_at, updated_at")
      .eq("workspace_id", auth.workspace.id)
      .gte("started_at", sinceIso)
      .limit(500)
      .returns<AutomationRunRow[]>(),
    admin
      .from("social_accounts")
      .select("id, username, status, status_detail, token_expires_at")
      .eq("workspace_id", auth.workspace.id)
      .eq("platform", "instagram")
      .neq("status", "revoked")
      .returns<SocialAccountRow[]>(),
    admin
      .from("jobs")
      .select("id, type, status, payload, last_error, completed_at")
      .eq("workspace_id", auth.workspace.id)
      .gte("completed_at", sinceIso)
      .limit(200)
      .returns<JobRow[]>(),
  ]);

  const runs = automationRuns ?? [];
  const retryWaitingRunIds = runs.filter((r) => r.status === "waiting" && r.waiting_reason === "retry").map((r) => r.id);

  // Query extra, só pros IDs que estão esperando retry agora (tipicamente
  // poucos) — pra mostrar "tentativa N/4" na Incident Rail sem escanear
  // automation_run_steps inteiro.
  const retryAttemptCounts: Record<string, number> = {};
  if (retryWaitingRunIds.length > 0) {
    const { data: failedSteps } = await admin
      .from("automation_run_steps")
      .select("automation_run_id")
      .in("automation_run_id", retryWaitingRunIds)
      .eq("status", "failed");
    for (const step of failedSteps ?? []) {
      const id = (step as { automation_run_id: string }).automation_run_id;
      retryAttemptCounts[id] = (retryAttemptCounts[id] ?? 0) + 1;
    }
  }

  const webhookHealth = classifyWebhookHealth(webhookEvents ?? [], nowIso);
  const automationHealth = classifyAutomationHealth(runs, nowIso);
  const socialHealth = classifySocialAccountHealth(socialAccounts ?? []);
  const tokenHealth = classifyTokenMaintenanceHealth(jobs ?? []);
  const qstashHealth = classifyQstashHealth(jobs ?? []);
  const incidents = buildIncidentRail({
    webhookEvents: webhookEvents ?? [],
    automationRuns: runs,
    jobs: jobs ?? [],
    retryAttemptCounts,
  });

  return (
    <>
      <PageHeader
        title="Health"
        description="Estado operacional do PITCHAT — dados reais, nunca simulados."
        action={
          <div className="flex items-center gap-1 rounded-[var(--radius-panel-sm)] border border-border-subtle bg-surface-1 p-0.5">
            {WINDOWS.map((w) => (
              <Link
                key={w.minutes}
                href={`/dashboard/health?window=${w.minutes}`}
                className={`rounded-[4px] px-2.5 py-1 text-xs font-medium transition-colors duration-[var(--motion-fast)] ${
                  w.minutes === windowMinutes ? "bg-surface-2 text-text" : "text-text-muted hover:text-text-secondary"
                }`}
              >
                {w.label}
              </Link>
            ))}
          </div>
        }
      />

      <div className="flex flex-col gap-6 px-6 pb-10 md:px-8">
        <SectionPanel title="Status geral">
          <ul className="divide-y divide-border-subtle">
            <StatusRow label="Webhook" status={webhookHealth.status} reason={webhookHealth.reason} />
            <StatusRow label="Automations" status={automationHealth.status} reason={automationHealth.reason} />
            <StatusRow label="Instagram Accounts" status={socialHealth.status} reason={socialHealth.reason} />
            <StatusRow label="Token Maintenance" status={tokenHealth.status} reason={tokenHealth.reason} />
            <StatusRow label="QStash" status={qstashHealth.status} reason={qstashHealth.reason} />
          </ul>
        </SectionPanel>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <SectionPanel title="Webhook Events" caption="webhook_events não tem workspace_id ainda — contagem global, não só deste workspace.">
            <div className="flex flex-wrap">
              <Stat label="Processed" value={webhookHealth.processed} color="var(--success)" />
              <Stat label="Pending" value={webhookHealth.pending} color={webhookHealth.oldestPendingAgeMinutes ? "var(--warning)" : undefined} />
              <Stat label="Failed" value={webhookHealth.failed} color={webhookHealth.failed > 0 ? "var(--danger)" : undefined} />
              <Stat label="Invalid signature" value={webhookHealth.invalidSignature} color={webhookHealth.invalidSignature > 0 ? "var(--danger)" : undefined} />
            </div>
            {(webhookHealth.socialAccountNotFoundCount > 0 || webhookHealth.consecutiveFailures > 0) && (
              <div className="border-t border-border-subtle px-5 py-3 text-xs text-text-secondary">
                {webhookHealth.socialAccountNotFoundCount > 0 && <p>⚠ {webhookHealth.socialAccountNotFoundCount} evento(s) sem social_account correspondente.</p>}
                {webhookHealth.consecutiveFailures > 0 && <p>⚠ {webhookHealth.consecutiveFailures} falha(s) consecutiva(s) mais recentes.</p>}
              </div>
            )}
          </SectionPanel>

          <SectionPanel title="Automation Runs">
            <div className="flex flex-wrap">
              <Stat label="Running" value={automationHealth.running} />
              <Stat label="Waiting" value={automationHealth.waiting} />
              <Stat label="Completed" value={automationHealth.completed} color="var(--success)" />
              <Stat label="Failed" value={automationHealth.failed} color={automationHealth.failed > 0 ? "var(--danger)" : undefined} />
            </div>
            <div className="border-t border-border-subtle px-5 py-3 text-xs text-text-secondary">
              <p>
                Waiting — quick_reply: <span className="font-mono tabular-nums">{automationHealth.waitingByReason.quick_reply}</span> · delay:{" "}
                <span className="font-mono tabular-nums">{automationHealth.waitingByReason.delay}</span> · retry:{" "}
                <span className="font-mono tabular-nums">{automationHealth.waitingByReason.retry}</span>
              </p>
              {automationHealth.stuckRunning.length > 0 && <p className="mt-1 text-danger">⚠ {automationHealth.stuckRunning.length} run(s) presa(s) em running.</p>}
              {automationHealth.waitingTooLong.length > 0 && <p className="mt-1 text-warning">⚠ {automationHealth.waitingTooLong.length} run(s) esperando além do esperado.</p>}
            </div>
          </SectionPanel>

          <SectionPanel title="Instagram Accounts">
            {socialHealth.accounts.length === 0 ? (
              <p className="px-5 py-4 text-sm text-text-muted">Nenhuma conta conectada ainda.</p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {socialHealth.accounts.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-text">{a.username ? `@${a.username}` : a.id.slice(0, 8)}</p>
                      <p className="text-xs text-text-muted">
                        Token expira: {formatDateTime(a.token_expires_at)}
                        {a.expiringSoon && " · em breve"}
                      </p>
                    </div>
                    <span
                      className="shrink-0 text-xs"
                      style={{ color: a.status === "connected" ? (a.expiringSoon ? "var(--warning)" : "var(--success)") : "var(--danger)" }}
                    >
                      {a.status}
                      {a.status_detail ? ` · ${a.status_detail}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </SectionPanel>

          <SectionPanel title="Token Maintenance">
            <div className="flex flex-wrap">
              <Stat label="Success" value={tokenHealth.outcomeCounts.refresh_success} color="var(--success)" />
              <Stat label="Retryable fail" value={tokenHealth.outcomeCounts.refresh_retryable_failure} color={tokenHealth.outcomeCounts.refresh_retryable_failure > 0 ? "var(--warning)" : undefined} />
              <Stat label="Reauth required" value={tokenHealth.outcomeCounts.reauth_required} color={tokenHealth.outcomeCounts.reauth_required > 0 ? "var(--danger)" : undefined} />
              <Stat label="Non-retryable fail" value={tokenHealth.outcomeCounts.refresh_non_retryable_failure} color={tokenHealth.outcomeCounts.refresh_non_retryable_failure > 0 ? "var(--danger)" : undefined} />
            </div>
          </SectionPanel>
        </div>

        <SectionPanel title="QStash / Jobs" caption={qstashHealth.total === 0 ? qstashHealth.reason : undefined}>
          <div className="flex flex-wrap">
            <Stat label="Total" value={qstashHealth.total} />
            <Stat label="Succeeded" value={qstashHealth.succeeded} color="var(--success)" />
            <Stat label="Failed" value={qstashHealth.failed} color={qstashHealth.failed > 0 ? "var(--danger)" : undefined} />
          </div>
        </SectionPanel>

        <SectionPanel title="Incident Rail" caption={incidents.length === 0 ? "Nenhum sinal de atenção na janela." : undefined}>
          {incidents.length > 0 && (
            <ul className="flex flex-col gap-3 border-l-2 border-border py-4 pl-5 pr-5">
              {incidents.map((entry, i) => {
                const cfg = INCIDENT_MARKER[entry.severity];
                return (
                  <li key={i} className="relative flex items-start gap-2.5">
                    <span className="absolute -left-[26px] top-[3px]">
                      <SignalMarker type={cfg.marker} style={{ color: cfg.color }} />
                    </span>
                    <div className="min-w-0">
                      <p className="font-mono text-xs text-text-muted">{formatDateTime(entry.at)}</p>
                      <p className="text-sm font-medium text-text">{entry.label}</p>
                      <p className="text-xs text-text-secondary">{entry.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionPanel>
      </div>
    </>
  );
}
