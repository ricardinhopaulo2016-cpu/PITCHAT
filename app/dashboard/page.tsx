import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app-shell/page-header";
import { StatStrip } from "@/components/dashboard/stat-strip";
import { ActivityRail, type ActivityEntry } from "@/components/dashboard/activity-rail";
import { StatusIndicator, type AutomationStatus } from "@/components/ui/status-indicator";
import { SignalMarker } from "@/components/icons/pitchat";

type SocialAccountRow = { id: string; username: string | null; status: string; profile_id: string; updated_at: string };
type AutomationRow = { id: string; name: string; status: AutomationStatus; profile_id: string; updated_at: string };

export default async function DashboardPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const [{ data: socialAccounts }, { data: automations }, { count: failedRunsCount }] = await Promise.all([
    admin
      .from("social_accounts")
      .select("id, username, status, profile_id, updated_at")
      .eq("workspace_id", auth.workspace.id)
      .returns<SocialAccountRow[]>(),
    admin
      .from("automations")
      .select("id, name, status, profile_id, updated_at")
      .eq("workspace_id", auth.workspace.id)
      .order("updated_at", { ascending: false })
      .returns<AutomationRow[]>(),
    admin
      .from("automation_runs")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", auth.workspace.id)
      .eq("status", "failed"),
  ]);

  const connectedAccounts = (socialAccounts ?? []).filter((a) => a.status === "connected");
  const activeAutomations = (automations ?? []).filter((a) => a.status === "active");

  const activity: ActivityEntry[] = [
    ...(automations ?? []).map((a) => ({
      id: `automation-${a.id}`,
      marker: "logic" as const,
      title: a.status === "active" ? "Automação ativada" : "Automação atualizada",
      detail: a.name,
      timestamp: a.updated_at,
    })),
    ...(socialAccounts ?? []).map((s) => ({
      id: `social-${s.id}`,
      marker: "action" as const,
      title: s.status === "connected" ? "Conta conectada" : "Conta atualizada",
      detail: s.username ? `@${s.username}` : undefined,
      timestamp: s.updated_at,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 8);

  return (
    <>
      <PageHeader title="Dashboard" description="Visão geral da sua operação no Instagram." />

      <div className="px-6 pb-10 md:px-8">
        <StatStrip
          stats={[
            { label: connectedAccounts.length === 1 ? "conta conectada" : "contas conectadas", value: connectedAccounts.length },
            { label: activeAutomations.length === 1 ? "automação ativa" : "automações ativas", value: activeAutomations.length },
            { label: "erros recentes", value: failedRunsCount ?? 0, tone: "danger" },
          ]}
        />

        <div className="mt-7 grid grid-cols-1 gap-7 lg:grid-cols-[1.2fr_1fr]">
          <section className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
            <h2 className="border-b border-border-subtle px-5 py-3.5 text-[15px] font-semibold text-text">
              Atividade recente
            </h2>
            <ActivityRail entries={activity} />
          </section>

          <div className="flex flex-col gap-7">
            <section className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
              <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
                <h2 className="text-[15px] font-semibold text-text">Contas conectadas</h2>
                <Link href="/dashboard/social-accounts" className="text-xs text-text-secondary hover:text-text">
                  Ver todas →
                </Link>
              </div>
              {connectedAccounts.length === 0 ? (
                <p className="px-5 py-6 text-sm text-text-muted">Nenhuma conta conectada.</p>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {connectedAccounts.map((a) => (
                    <li key={a.id} className="flex items-center justify-between px-5 py-3">
                      <span className="text-sm text-text">@{a.username}</span>
                      <StatusIndicator status="active" />
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
              <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3.5">
                <h2 className="text-[15px] font-semibold text-text">Automations</h2>
                <Link href="/dashboard/automations" className="text-xs text-text-secondary hover:text-text">
                  Ver todas →
                </Link>
              </div>
              {(automations ?? []).length === 0 ? (
                <p className="px-5 py-6 text-sm text-text-muted">Nenhuma automação criada.</p>
              ) : (
                <ul className="divide-y divide-border-subtle">
                  {(automations ?? []).slice(0, 4).map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-3">
                      <span className="flex items-center gap-2 truncate text-sm text-text">
                        <SignalMarker type="logic" className="shrink-0 text-text-muted" />
                        <span className="truncate">{a.name}</span>
                      </span>
                      <StatusIndicator status={a.status} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      </div>
    </>
  );
}
