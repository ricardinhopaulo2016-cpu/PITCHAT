import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadAutomationForWorkspace, loadDraftVersion, loadVersionById } from "@/lib/automation/repo";
import { decompileGraphToFlow } from "@/lib/automation/flow-spec";
import { StatusIndicator, type AutomationStatus } from "@/components/ui/status-indicator";
import { FlowEditor } from "./flow-editor";

export default async function AutomationEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const automation = await loadAutomationForWorkspace(admin, id, auth.workspace.id);
  if (!automation) notFound();

  // Independentes entre si (só dependem do automation já carregado) — paraleliza.
  const [{ data: profile }, { data: socialAccount }, draft] = await Promise.all([
    admin.from("profiles").select("name").eq("id", automation.profile_id).maybeSingle(),
    admin
      .from("social_accounts")
      .select("username")
      .eq("profile_id", automation.profile_id)
      .eq("status", "connected")
      .maybeSingle(),
    loadDraftVersion(admin, id),
  ]);
  const version = draft ?? (automation.current_version_id ? await loadVersionById(admin, automation.current_version_id) : null);

  const spec = version ? decompileGraphToFlow(version.graph) : { steps: [] };

  return (
    <>
      <div className="px-6 pb-5 pt-7 md:px-8 md:pt-8">
        <Link href="/dashboard/automations" className="mb-4 inline-flex items-center gap-1 text-sm text-text-secondary hover:text-text">
          <ChevronLeft className="h-3.5 w-3.5" /> Automations
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-[26px] font-semibold tracking-[-0.025em] text-text">{automation.name}</h1>
              <StatusIndicator status={automation.status as AutomationStatus} />
            </div>
            <p className="mt-1 text-sm text-text-secondary">
              Instagram{socialAccount?.username ? ` · @${socialAccount.username}` : profile ? ` · ${profile.name}` : ""}
            </p>
          </div>
        </div>
      </div>

      <FlowEditor
        automationId={id}
        initialSteps={spec?.steps ?? []}
        decompileFailed={version !== null && spec === null}
        hasDraft={!!draft}
      />
    </>
  );
}
