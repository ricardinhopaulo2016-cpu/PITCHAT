import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronDown } from "lucide-react";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app-shell/page-header";
import { AccountTile } from "@/components/ui/account-tile";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusIndicator, ErrorIndicator, type AutomationStatus } from "@/components/ui/status-indicator";
import { groupAccountsByProfile, listWorkspaceInstagramAccounts } from "@/lib/social-accounts/repo";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { formatRange, parseRange, rangeToIso } from "@/lib/ui/date-range";
import { summarizeFlow } from "@/lib/automation/flow-summary";
import type { Graph } from "@/lib/automation/graph";
import { AutomationRowActions } from "./automation-row-actions";
import { NewAutomationDialog } from "./new-automation-dialog";

type ProfileRow = { id: string; name: string };
type AutomationRow = {
  id: string;
  name: string;
  status: AutomationStatus;
  profile_id: string;
  social_account_id: string | null;
  current_version_id: string | null;
  updated_at: string;
};
type RunStat = { total: number; errors: number };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ ver?: string; de?: string; ate?: string }> }) {
  const { ver, de, ate } = await searchParams;
  const range = parseRange(de, ate);
  const rangeIso = range ? rangeToIso(range) : null;
  const rangeQuery = range ? `&de=${range.from}&ate=${range.to}` : "";

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  // profiles e automations não dependem um do outro: paraleliza.
  const [{ data: profiles }, { data: automations }, accounts] = await Promise.all([
    admin.from("profiles").select("id, name").eq("workspace_id", auth.workspace.id).returns<ProfileRow[]>(),
    admin
      .from("automations")
      .select("id, name, status, profile_id, social_account_id, current_version_id, updated_at")
      .eq("workspace_id", auth.workspace.id)
      .order("updated_at", { ascending: false })
      .returns<AutomationRow[]>(),
    listWorkspaceInstagramAccounts(admin, auth.workspace.id),
  ]);

  // Conta no banco: a lista de linhas cortaria em 1.000 assim que um post escalar.
  const countRuns = async (automationId: string, onlyFailed: boolean) => {
    let query = admin.from("automation_runs").select("id", { count: "exact", head: true }).eq("automation_id", automationId);
    if (onlyFailed) query = query.eq("status", "failed");
    if (rangeIso) query = query.gte("started_at", rangeIso.start).lt("started_at", rangeIso.end);
    const { count } = await query;
    return count ?? 0;
  };
  // Uma consulta agrupada. Sem a migration, cai nas contagens por automação.
  const { data: groupedStats, error: groupedStatsError } = await admin.rpc("automation_run_stats", {
    p_workspace_id: auth.workspace.id,
    p_start: rangeIso?.start ?? null,
    p_end: rangeIso?.end ?? null,
  });
  const stats: (readonly [string, RunStat])[] = !groupedStatsError && groupedStats
    ? (groupedStats as { automation_id: string; total: number | string; errors: number | string }[]).map((row) => [
        row.automation_id,
        { total: Number(row.total), errors: Number(row.errors) },
      ] as const)
    : await Promise.all(
        (automations ?? []).map(async (a) => {
          const [total, errors] = await Promise.all([countRuns(a.id, false), countRuns(a.id, true)]);
          return [a.id, { total, errors }] as const;
        })
      );
  const runStats = new Map<string, RunStat>(stats);
  const statOf = (id: string): RunStat => runStats.get(id) ?? { total: 0, errors: 0 };

  // Sem social_account_id, a automação vale para todas as contas conectadas do perfil.
  const connectedByProfile = groupAccountsByProfile(accounts.filter((a) => a.status === "connected"));
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const all = automations ?? [];
  const active = all.filter((a) => a.status === "active").sort((a, b) => statOf(b.id).total - statOf(a.id).total);
  const inactive = all.filter((a) => a.status !== "active");

  const selected = all.find((a) => a.id === ver) ?? active[0] ?? all[0];
  const { data: version } = selected?.current_version_id
    ? await admin.from("automation_versions").select("graph").eq("id", selected.current_version_id).maybeSingle()
    : { data: null };
  const steps = summarizeFlow((version?.graph as Graph | undefined) ?? null);

  const usernameOf = (a: AutomationRow) => (a.social_account_id ? (accountById.get(a.social_account_id)?.username ?? null) : null);
  const scopeOf = (a: AutomationRow) => {
    if (a.social_account_id) {
      const username = usernameOf(a);
      return username ? `@${username}` : "Conta indisponível";
    }
    const n = connectedByProfile.get(a.profile_id)?.length ?? 0;
    return n === 0 ? "Nenhuma conta conectada" : n === 1 ? "1 conta do perfil" : `${n} contas do perfil`;
  };

  return (
    <>
      <PageHeader
        title="Automações"
        description={range ? `Disparos de ${formatRange(range)}.` : "O que acontece quando alguém comenta num post das suas contas."}
        action={profiles && profiles.length > 0 ? <NewAutomationDialog profiles={profiles} accounts={accounts} /> : undefined}
      />

      <div className="px-6 pb-14 md:px-11">
        {all.length > 0 && (
          <div className="mb-4">
            <DateRangeFilter />
          </div>
        )}
        {!profiles || profiles.length === 0 ? (
          <EmptyState title="Nenhum perfil cadastrado" description="Crie um perfil antes de criar uma automação." />
        ) : all.length === 0 ? (
          <EmptyState title="Nenhuma automação criada" description="Crie a primeira para começar a responder comentários do Instagram." />
        ) : (
          <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
            <div className="flex min-w-0 flex-col gap-4">
              <section className="overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
                <h2 className="px-6 py-5 text-lg font-semibold text-text">Ativas</h2>
                {active.length === 0 ? (
                  <p className="border-t border-border-subtle px-6 py-5 text-sm text-text-muted">Nenhuma automação ativa.</p>
                ) : (
                  <ul>
                    {active.map((automation) => {
                      const stat = statOf(automation.id);
                      const isSelected = automation.id === selected?.id;
                      return (
                        <li
                          key={automation.id}
                          className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border-subtle py-3 pl-6 pr-4 transition-colors duration-[var(--motion-fast)] ${
                            isSelected ? "bg-surface-2" : "hover:bg-surface-2"
                          }`}
                        >
                          <Link href={`/dashboard/automations?ver=${automation.id}${rangeQuery}`} aria-current={isSelected ? "true" : undefined} className="flex min-w-[220px] flex-1 items-center gap-3.5">
                            <AccountTile username={usernameOf(automation) ?? automation.name} size="lg" />
                            <span className="min-w-0">
                              <span className="block truncate font-semibold text-text">{automation.name}</span>
                              <span className="block truncate text-sm text-text-secondary">{scopeOf(automation)}</span>
                            </span>
                          </Link>
                          <span className="w-20 text-right">
                            <span className="block text-xl font-semibold text-text">{stat.total}</span>
                            <span className="block text-xs text-text-muted">disparos</span>
                          </span>
                          <span className="flex w-52 items-center gap-2 text-sm" style={{ color: stat.total > 0 ? "var(--success)" : "var(--warning)" }}>
                            <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: "currentColor" }} />
                            {stat.total > 0 ? "Rodando" : range ? "Sem disparo no período" : "Sem disparo ainda"}
                          </span>
                          {stat.errors > 0 && <ErrorIndicator count={stat.errors} />}
                          <AutomationRowActions automationId={automation.id} status={automation.status} hasPublishedVersion={!!automation.current_version_id} />
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {inactive.length > 0 && (
                <details className="group overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-5 [&::-webkit-details-marker]:hidden">
                    <h2 className="text-lg font-semibold text-text">Pausadas e rascunhos</h2>
                    <span className="flex items-center gap-2 text-sm text-text-muted">
                      {inactive.length}
                      <ChevronDown className="h-4 w-4 transition-transform duration-[var(--motion-ui)] group-open:rotate-180" />
                    </span>
                  </summary>
                  <ul>
                    {inactive.map((automation) => {
                      const stat = statOf(automation.id);
                      return (
                        <li key={automation.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle py-2.5 pl-6 pr-4 text-sm">
                          <Link href={`/dashboard/automations/${automation.id}`} className="min-w-[220px] flex-1 truncate text-text hover:text-signal">
                            {automation.name}
                          </Link>
                          <span className="text-text-muted">{stat.total} disparos</span>
                          {stat.errors > 0 && <ErrorIndicator count={stat.errors} />}
                          <StatusIndicator status={automation.status} />
                          <AutomationRowActions automationId={automation.id} status={automation.status} hasPublishedVersion={!!automation.current_version_id} />
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
            </div>

            {selected && (
              <aside className="flex flex-col gap-5 rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-6" aria-label={`Fluxo de ${selected.name}`}>
                <div>
                  <h2 className="text-lg font-semibold text-text">{selected.name}</h2>
                  <p className="mt-1 text-sm text-text-secondary">O caminho de quem comenta</p>
                </div>
                {steps.length === 0 ? (
                  <p className="text-sm text-text-muted">Este fluxo ainda não foi publicado.</p>
                ) : (
                  <ol>
                    {steps.map((step, index) => (
                      <li key={step.id} className="flex gap-3.5">
                        <span className="flex w-8 shrink-0 flex-col items-center">
                          <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[13px] font-bold ${index === 0 ? "bg-signal text-signal-on" : "bg-surface-3 text-text"}`}>
                            {index + 1}
                          </span>
                          {index < steps.length - 1 && <span aria-hidden="true" className="min-h-[18px] w-0.5 flex-1 bg-surface-3" />}
                        </span>
                        <span className="min-w-0 pb-5 pt-1">
                          <span className="block font-semibold text-text">{step.title}</span>
                          {step.detail && <span className="mt-0.5 line-clamp-2 block text-sm text-text-secondary">{step.detail}</span>}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
                <Link
                  href={`/dashboard/automations/${selected.id}`}
                  className="flex h-11 items-center justify-center rounded-[var(--radius-button)] border border-border font-semibold text-text transition-colors duration-[var(--motion-fast)] hover:border-border-strong"
                >
                  Editar fluxo
                </Link>
              </aside>
            )}
          </div>
        )}
      </div>
    </>
  );
}
