import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { AppShell } from "@/components/app-shell/app-shell";
import type { ChannelSwitcherAccount } from "@/components/app-shell/channel-switcher";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  // Dado real pro Channel Switcher (Fase B) — mesmo filtro workspace_id +
  // platform + status já usado em app/dashboard/social-accounts/page.tsx.
  // Nunca sem .limit(): contas por workspace são poucas hoje, mas é hábito
  // do projeto nunca fazer select sem teto.
  const admin = getSupabaseAdminClient();
  let accounts: ChannelSwitcherAccount[] = [];
  if (admin) {
    const { data } = await admin
      .from("social_accounts")
      .select("id, username, status")
      .eq("workspace_id", auth.workspace.id)
      .eq("platform", "instagram")
      .neq("status", "revoked")
      .limit(20);
    accounts = data ?? [];
  }

  return (
    <AppShell workspaceName={auth.workspace.name} email={auth.email ?? ""} accounts={accounts}>
      {children}
    </AppShell>
  );
}
