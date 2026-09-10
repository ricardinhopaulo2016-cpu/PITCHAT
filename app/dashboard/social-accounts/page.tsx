import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { needsRefresh } from "@/lib/meta/oauth";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ChannelIcon } from "@/components/icons/pitchat";
import { DisconnectButton } from "./disconnect-button";

type ProfileRow = { id: string; name: string; slug: string };
type SocialAccountRow = {
  id: string;
  profile_id: string;
  username: string | null;
  status: string;
  status_detail: string | null;
  token_expires_at: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  connected: "Conectado",
  pending: "Conectando…",
  expired: "Token expirado",
  revoked: "Desconectado",
  error: "Erro na conexão",
};

const STATUS_COLOR: Record<string, string> = {
  connected: "var(--success)",
  pending: "var(--text-muted)",
  expired: "var(--warning)",
  revoked: "var(--text-muted)",
  error: "var(--danger)",
};

export default async function SocialAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; detail?: string }>;
}) {
  const { status, detail } = await searchParams;

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const { data: profiles } = await admin
    .from("profiles")
    .select("id, name, slug")
    .eq("workspace_id", auth.workspace.id)
    .returns<ProfileRow[]>();

  const { data: socialAccounts } = await admin
    .from("social_accounts")
    .select("id, profile_id, username, status, status_detail, token_expires_at")
    .eq("workspace_id", auth.workspace.id)
    .eq("platform", "instagram")
    .neq("status", "revoked")
    .returns<SocialAccountRow[]>();

  const { data: activeAutomations } = await admin
    .from("automations")
    .select("profile_id")
    .eq("workspace_id", auth.workspace.id)
    .eq("status", "active");

  const activeCountByProfile = new Map<string, number>();
  for (const a of activeAutomations ?? []) {
    activeCountByProfile.set(a.profile_id, (activeCountByProfile.get(a.profile_id) ?? 0) + 1);
  }

  const accountByProfile = new Map((socialAccounts ?? []).map((sa) => [sa.profile_id, sa]));

  return (
    <>
      <PageHeader title="Social Accounts" description="Contas do Instagram conectadas a cada perfil do PITCHAT." />

      <div className="px-6 pb-10 md:px-8">
        {status === "connected" && (
          <p className="mb-5 rounded-[var(--radius-panel-sm)] border border-success bg-success-soft px-3.5 py-2.5 text-sm text-text">
            Instagram conectado.
          </p>
        )}
        {status === "error" && (
          <p className="mb-5 rounded-[var(--radius-panel-sm)] border border-danger bg-danger-soft px-3.5 py-2.5 text-sm text-text">
            Não foi possível conectar o Instagram{detail ? ` (${detail})` : ""}.
          </p>
        )}

        {!profiles || profiles.length === 0 ? (
          <EmptyState title="Nenhum perfil cadastrado" description="Crie um perfil antes de conectar uma conta do Instagram." />
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle">
            <div className="border-b border-border-subtle bg-surface-1 px-5 py-2.5 text-xs font-medium uppercase tracking-wide text-text-muted">
              Instagram
            </div>
            <ul className="divide-y divide-border-subtle bg-surface-1">
              {profiles.map((profile) => {
                const account = accountByProfile.get(profile.id);
                const expiringSoon = account?.token_expires_at && needsRefresh(new Date(account.token_expires_at));
                const activeCount = activeCountByProfile.get(profile.id) ?? 0;

                return (
                  <li key={profile.id} className="flex items-center gap-4 px-5 py-4">
                    <ChannelIcon className="h-6 w-6 shrink-0 text-text-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text">
                        {account?.username ? `@${account.username}` : profile.name}
                      </p>
                      <p className="text-xs text-text-muted">Instagram · {profile.name}</p>
                      {account ? (
                        <p className="mt-1 flex items-center gap-1.5 text-xs" style={{ color: STATUS_COLOR[account.status] }}>
                          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[account.status] }} />
                          {STATUS_LABEL[account.status] ?? account.status}
                          {expiringSoon && " · token expira em breve"}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-text-muted">Nenhuma conta conectada</p>
                      )}
                      {account?.status === "connected" && activeCount > 0 && (
                        <p className="mt-0.5 text-xs text-text-muted">
                          {activeCount} {activeCount === 1 ? "automação ativa" : "automações ativas"}
                        </p>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-3">
                      {account && account.status === "connected" ? (
                        <>
                          <a href={`/api/auth/meta/start?profileId=${profile.id}`} className="text-sm text-text-secondary hover:text-text">
                            Reconectar
                          </a>
                          <DisconnectButton socialAccountId={account.id} />
                        </>
                      ) : (
                        <a
                          href={`/api/auth/meta/start?profileId=${profile.id}`}
                          className="inline-flex h-9 items-center justify-center rounded-[var(--radius-button)] bg-signal px-3.5 text-sm font-medium text-signal-on transition-colors duration-[var(--motion-fast)] hover:bg-signal-hover"
                        >
                          Conectar Instagram
                        </a>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </>
  );
}
