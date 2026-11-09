import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { listWorkspaceChannelAccounts } from "@/lib/channel/repo";
import { countUnreadConversations } from "@/lib/inbox/repo";
import { AppShell } from "@/components/app-shell/app-shell";
import type { ChannelAccount } from "@/lib/channel/repo";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  // Dado real pro Channel Switcher (D1) — com profile já embutido pro
  // agrupamento visual, sem N+1.
  const admin = getSupabaseAdminClient();
  const [accounts, inboxUnreadCount]: [ChannelAccount[], number] = admin
    ? await Promise.all([listWorkspaceChannelAccounts(admin, auth.workspace.id), countUnreadConversations(admin, auth.workspace.id)])
    : [[], 0];

  return (
    <AppShell workspaceId={auth.workspace.id} workspaceName={auth.workspace.name} email={auth.email ?? ""} accounts={accounts} inboxUnreadCount={inboxUnreadCount}>
      {children}
    </AppShell>
  );
}
