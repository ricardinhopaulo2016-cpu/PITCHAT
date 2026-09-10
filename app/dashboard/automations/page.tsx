import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusIndicator, ErrorIndicator, type AutomationStatus } from "@/components/ui/status-indicator";
import { FlowIcon } from "@/components/icons/pitchat";
import { CreateAutomationForm } from "./create-automation-form";
import { AutomationRowActions } from "./automation-row-actions";

type ProfileRow = { id: string; name: string };
type AutomationRow = {
  id: string;
  name: string;
  status: AutomationStatus;
  profile_id: string;
  current_version_id: string | null;
  updated_at: string;
};
type RunRow = { automation_id: string; status: string; started_at: string };

export default async function AutomationsPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  // profiles e automations não dependem um do outro — paraleliza.
  const [{ data: profiles }, { data: automations }] = await Promise.all([
    admin.from("profiles").select("id, name").eq("workspace_id", auth.workspace.id).returns<ProfileRow[]>(),
    admin
      .from("automations")
      .select("id, name, status, profile_id, current_version_id, updated_at")
      .eq("workspace_id", auth.workspace.id)
      .order("updated_at", { ascending: false })
      .returns<AutomationRow[]>(),
  ]);

  const automationIds = (automations ?? []).map((a) => a.id);
  const { data: runs } =
    automationIds.length > 0
      ? await admin
          .from("automation_runs")
          .select("automation_id, status, started_at")
          .in("automation_id", automationIds)
          .returns<RunRow[]>()
      : { data: [] as RunRow[] };

  const runStats = new Map<string, { total: number; errors: number; lastRun: string | null }>();
  for (const run of runs ?? []) {
    const stat = runStats.get(run.automation_id) ?? { total: 0, errors: 0, lastRun: null };
    stat.total += 1;
    if (run.status === "failed") stat.errors += 1;
    if (!stat.lastRun || run.started_at > stat.lastRun) stat.lastRun = run.started_at;
    runStats.set(run.automation_id, stat);
  }

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p.name]));

  return (
    <>
      <PageHeader title="Automations" description="Fluxos que respondem aos comentários e mensagens das suas contas." />

      <div className="px-6 pb-10 md:px-8">
        {!profiles || profiles.length === 0 ? (
          <EmptyState
            title="Nenhum perfil cadastrado"
            description="Crie um perfil antes de criar uma automação."
          />
        ) : (
          <div className="mb-6">
            <CreateAutomationForm profiles={profiles} />
          </div>
        )}

        {!automations || automations.length === 0 ? (
          <EmptyState
            title="Nenhuma automação criada"
            description="Crie a primeira automação acima para começar a responder comentários do Instagram."
          />
        ) : (
          <div className="overflow-x-auto rounded-[var(--radius-panel-lg)] border border-border-subtle">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs text-text-muted">
                  <th className="px-5 py-2.5 font-medium">Nome</th>
                  <th className="px-3 py-2.5 font-medium">Conta</th>
                  <th className="px-3 py-2.5 font-medium">Trigger</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-3 py-2.5 font-medium">Runs</th>
                  <th className="px-3 py-2.5 font-medium">Erros</th>
                  <th className="px-3 py-2.5 font-medium">Atualizada</th>
                  <th className="px-5 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {automations.map((automation) => {
                  const stat = runStats.get(automation.id) ?? { total: 0, errors: 0, lastRun: null };
                  return (
                    <tr
                      key={automation.id}
                      className="border-b border-border-subtle bg-surface-1 transition-colors duration-[var(--motion-fast)] last:border-b-0 hover:bg-surface-2"
                    >
                      <td className="px-5 py-3.5">
                        <Link
                          href={`/dashboard/automations/${automation.id}`}
                          className="flex items-center gap-2 font-medium text-text hover:text-signal"
                        >
                          <FlowIcon className="h-4 w-4 shrink-0 text-text-muted" />
                          {automation.name}
                        </Link>
                      </td>
                      <td className="px-3 py-3.5 text-text-secondary">{profileById.get(automation.profile_id) ?? "—"}</td>
                      <td className="px-3 py-3.5 text-text-secondary">Instagram Comment</td>
                      <td className="px-3 py-3.5">
                        <StatusIndicator status={automation.status} />
                      </td>
                      <td className="px-3 py-3.5 text-text-secondary">{stat.total}</td>
                      <td className="px-3 py-3.5">
                        <ErrorIndicator count={stat.errors} />
                      </td>
                      <td className="px-3 py-3.5 font-mono text-xs text-text-muted">
                        {stat.lastRun ? new Date(stat.lastRun).toLocaleString("pt-BR") : "—"}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <AutomationRowActions
                          automationId={automation.id}
                          status={automation.status}
                          hasPublishedVersion={!!automation.current_version_id}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
