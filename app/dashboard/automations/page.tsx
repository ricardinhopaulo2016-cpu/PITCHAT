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
type RunRow = { automation_id: string; status: string; started_at: string };
type RunStat = { total: number; errors: number };

export default async function AutomationsPage({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const { ver } = await searchParams;

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

  const automationIds = (automations ?? []).map((a) => a.id);
  const { data: runs } =
    automationIds.length > 0
      ? await admin.from("automation_runs").select("automation_id, status, started_at").in("automation_id", automationIds).returns<RunRow[]>()
      : { data: [] as RunRow[] };

  const runStats = new Map<string, RunStat>();
  for (const run of runs ?? []) {
    const stat = runStats.get(run.automation_id) ?? { total: 0, errors: 0 };
    stat.total += 1;
    if (run.status === "failed") stat.errors += 1;
    runStats.set(run.automation_id, stat);
  }
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
        description="O que acontece quando alguém comenta num post das suas contas."
        action={profiles && profiles.length > 0 ? <NewAutomationDialog profiles={profiles} accounts={accounts} /> : undefined}
      />

      <div className="px-6 pb-14 md:px-11">
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
                          <Link href={`/dashboard/automations?ver=${automation.id}`} aria-current={isSelected ? "true" : undefined} className="flex min-w-[220px] flex-1 items-center gap-3.5">
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
                          <span className="flex w-44 items-center gap-2 text-sm" style={{ color: stat.total > 0 ? "var(--success)" : "var(--warning)" }}>
                            <span aria-hidden="true" className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ background: "currentColor" }} />
                            {stat.total > 0 ? "Rodando" : "Sem disparo ainda"}
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
