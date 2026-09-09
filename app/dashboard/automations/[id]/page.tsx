import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadAutomationForWorkspace, loadDraftVersion, loadVersionById } from "@/lib/automation/repo";
import { decompileGraphToFlow } from "@/lib/automation/flow-spec";
import { FlowEditor } from "./flow-editor";

export default async function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const automation = await loadAutomationForWorkspace(admin, id, auth.workspace.id);
  if (!automation) notFound();

  const draft = await loadDraftVersion(admin, id);
  const version = draft ?? (automation.current_version_id ? await loadVersionById(admin, automation.current_version_id) : null);

  const spec = version ? decompileGraphToFlow(version.graph) : { steps: [] };

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{automation.name}</h1>
          {automation.description && <p className="text-sm opacity-60">{automation.description}</p>}
        </div>
        <Link href="/dashboard/automations" className="text-sm underline opacity-70">
          Voltar
        </Link>
      </div>

      <FlowEditor
        automationId={id}
        initialSteps={spec?.steps ?? []}
        decompileFailed={version !== null && spec === null}
        hasDraft={!!draft}
      />
    </main>
  );
}
