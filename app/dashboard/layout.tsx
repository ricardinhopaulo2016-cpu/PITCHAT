import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { listWorkspaceChannelAccounts } from "@/lib/channel/repo";
import { AppShell } from "@/components/app-shell/app-shell";
import type { ChannelSwitcherAccount } from "@/components/app-shell/channel-switcher";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  // Dado real pro Channel Switcher (D1) — com profile já embutido pro
  // agrupamento visual, sem N+1.
  const admin = getSupabaseAdminClient();
  const accounts: ChannelSwitcherAccount[] = admin ? await listWorkspaceChannelAccounts(admin, auth.workspace.id) : [];

  return (
    <AppShell workspaceName={auth.workspace.name} email={auth.email ?? ""} accounts={accounts}>
      {children}
    </AppShell>
  );
}
