import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { CreateAutomationForm } from "./create-automation-form";
import { AutomationRowActions } from "./automation-row-actions";

type ProfileRow = { id: string; name: string };
type AutomationRow = {
  id: string;
  name: string;
  status: "draft" | "active" | "paused" | "archived";
  profile_id: string;
  current_version_id: string | null;
  updated_at: string;
};
type RunRow = { automation_id: string; status: string; started_at: string };

const STATUS_LABEL: Record<string, string> = {
  draft: "Rascunho",
  active: "Ativa",
  paused: "Pausada",
  archived: "Arquivada",
};

export default async function AutomationsPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name")
    .eq("workspace_id", auth.workspace.id)
    .returns<ProfileRow[]>();

  const { data: automations } = await admin
    .from("automations")
    .select("id, name, status, profile_id, current_version_id, updated_at")
    .eq("workspace_id", auth.workspace.id)
    .order("updated_at", { ascending: false })
    .returns<AutomationRow[]>();

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
    <main className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Automations</h1>
        <Link href="/dashboard" className="text-sm underline opacity-70">
          Voltar
        </Link>
      </div>

      {!profiles || profiles.length === 0 ? (
        <p className="text-sm opacity-60">
          Nenhum perfil cadastrado ainda. Crie um em <code>profiles</code> antes de criar uma
          automação.
        </p>
      ) : (
        <CreateAutomationForm profiles={profiles} />
      )}

      {!automations || automations.length === 0 ? (
        <p className="mt-8 text-sm opacity-60">Nenhuma automação criada ainda.</p>
      ) : (
        <table className="mt-8 w-full text-sm">
          <thead>
            <tr className="border-b text-left opacity-60">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Profile</th>
              <th className="py-2 pr-4">Trigger</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Runs</th>
              <th className="py-2 pr-4">Errors</th>
              <th className="py-2 pr-4">Last Run</th>
              <th className="py-2 pr-4"></th>
            </tr>
          </thead>
          <tbody>
            {automations.map((automation) => {
              const stat = runStats.get(automation.id) ?? { total: 0, errors: 0, lastRun: null };
              return (
                <tr key={automation.id} className="border-b">
                  <td className="py-2 pr-4">
                    <Link href={`/dashboard/automations/${automation.id}`} className="underline">
                      {automation.name}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{profileById.get(automation.profile_id) ?? "—"}</td>
                  <td className="py-2 pr-4">Instagram Comment</td>
                  <td className="py-2 pr-4">{STATUS_LABEL[automation.status]}</td>
                  <td className="py-2 pr-4">{stat.total}</td>
                  <td className="py-2 pr-4">{stat.errors > 0 ? <span className="text-red-600">{stat.errors}</span> : 0}</td>
                  <td className="py-2 pr-4">{stat.lastRun ? new Date(stat.lastRun).toLocaleString("pt-BR") : "—"}</td>
                  <td className="py-2 pr-4">
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
      )}
    </main>
  );
}
