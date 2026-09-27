import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { needsRefresh } from "@/lib/meta/oauth";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { ChannelIcon } from "@/components/icons/pitchat";
import { DisconnectButton } from "./disconnect-button";
import { groupAccountsByProfile, listWorkspaceInstagramAccounts, type InstagramAccount } from "@/lib/social-accounts/repo";

type ProfileRow = { id: string; name: string; slug: string };

const STATUS_LABEL: Record<string, string> = {
  connected: "Conectado",
  pending: "Conectando…",
  expired: "Token expirado",
  revoked: "Desconectado",
  error: "Erro na conexão",
};

// status_detail vindo do job de refresh automático de token (ver
// app/api/cron/refresh-meta-tokens/route.ts) — nunca mostrar o valor cru
// (ex: "reauth_required") pro usuário final.
const STATUS_DETAIL_LABEL: Record<string, string> = {
  reauth_required: "Reconecte a conta — a Meta invalidou o token de acesso.",
  refresh_non_retryable_failure: "Reconecte a conta — não foi possível renovar o token automaticamente.",
};

// Motivos de recusa do callback (lib/meta/account-link.ts) — nunca mostrar o código cru.
const ERROR_DETAIL_LABEL: Record<string, string> = {
  wrong_account_authorized:
    "A conta autorizada no Instagram não é a que você quis reconectar. Nada foi alterado — entre na conta certa e tente de novo.",
  account_linked_to_other_profile: "Essa conta do Instagram já está conectada a outro perfil. Nada foi alterado.",
  account_in_other_workspace: "Essa conta do Instagram já está conectada a outro workspace. Nada foi alterado.",
  reconnect_target_not_found: "A conta que você tentou reconectar não foi encontrada. Nada foi alterado.",
};

const STATUS_COLOR: Record<string, string> = {
  connected: "var(--success)",
  pending: "var(--text-muted)",
  expired: "var(--warning)",
  revoked: "var(--text-muted)",
  error: "var(--danger)",
};

function AccountRow({ account }: { account: InstagramAccount }) {
  const expiringSoon = account.token_expires_at && needsRefresh(new Date(account.token_expires_at));
  const needsReconnect = account.status !== "connected" && account.status !== "pending";

  return (
    <li className="flex items-center gap-4 py-3.5">
      <ChannelIcon className="h-5 w-5 shrink-0 text-text-muted" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-text">{account.username ? `@${account.username}` : "Conta sem username"}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs" style={{ color: STATUS_COLOR[account.status] }}>
          <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[account.status] }} />
          {STATUS_LABEL[account.status] ?? account.status}
          {expiringSoon && account.status === "connected" && " · token expira em breve"}
        </p>
        {account.status_detail && STATUS_DETAIL_LABEL[account.status_detail] && (
          <p className="mt-0.5 text-xs text-warning">{STATUS_DETAIL_LABEL[account.status_detail]}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-3">
        {/* Reconectar ESTA conta (reconnect=<id>): o callback confere se a conta autorizada na Meta é a mesma. */}
        <a
          href={`/api/auth/meta/start?profileId=${account.profile_id}&reconnect=${account.id}`}
          className={
            needsReconnect
              ? "inline-flex h-8 items-center justify-center rounded-[var(--radius-button)] bg-signal px-3 text-sm font-medium text-signal-on transition-colors duration-[var(--motion-fast)] hover:bg-signal-hover"
              : "text-sm text-text-secondary hover:text-text"
          }
        >
          Reconectar
        </a>
        <DisconnectButton socialAccountId={account.id} />
      </div>
    </li>
  );
}

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

  // As três queries são independentes entre si — paralelizar em vez de
  // esperar uma pela outra economiza ~2 round-trips ao Postgres por load.
  const [{ data: profiles }, accounts, { data: activeAutomations }] = await Promise.all([
    admin.from("profiles").select("id, name, slug").eq("workspace_id", auth.workspace.id).returns<ProfileRow[]>(),
    listWorkspaceInstagramAccounts(admin, auth.workspace.id),
    admin.from("automations").select("profile_id").eq("workspace_id", auth.workspace.id).eq("status", "active"),
  ]);

  const activeCountByProfile = new Map<string, number>();
  for (const a of activeAutomations ?? []) {
    activeCountByProfile.set(a.profile_id, (activeCountByProfile.get(a.profile_id) ?? 0) + 1);
  }

  // Um perfil pode ter VÁRIAS contas (Fase D0) — agrupa, nunca colapsa numa só.
  const accountsByProfile = groupAccountsByProfile(accounts);

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
            {detail && ERROR_DETAIL_LABEL[detail]
              ? ERROR_DETAIL_LABEL[detail]
              : `Não foi possível conectar o Instagram${detail ? ` (${detail})` : ""}.`}
          </p>
        )}

        {!profiles || profiles.length === 0 ? (
          <EmptyState title="Nenhum perfil cadastrado" description="Crie um perfil antes de conectar uma conta do Instagram." />
        ) : (
          <div className="flex flex-col">
            {profiles.map((profile) => {
              const profileAccounts = accountsByProfile.get(profile.id) ?? [];
              const activeCount = activeCountByProfile.get(profile.id) ?? 0;
              const countLabel =
                profileAccounts.length === 0 ? "nenhuma conta" : profileAccounts.length === 1 ? "1 conta" : `${profileAccounts.length} contas`;

              return (
                <section
                  key={profile.id}
                  aria-labelledby={`profile-${profile.id}`}
                  className="border-t border-border-subtle py-5 first:border-t-0 first:pt-0"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 id={`profile-${profile.id}`} className="text-[15px] font-semibold text-text">
                        {profile.name}
                      </h2>
                      <p className="text-xs text-text-muted">Instagram · {countLabel}</p>
                    </div>
                    {profileAccounts.length === 0 ? (
                      <a
                        href={`/api/auth/meta/start?profileId=${profile.id}`}
                        className="inline-flex h-9 items-center justify-center rounded-[var(--radius-button)] bg-signal px-3.5 text-sm font-medium text-signal-on transition-colors duration-[var(--motion-fast)] hover:bg-signal-hover"
                      >
                        Conectar Instagram
                      </a>
                    ) : (
                      <a
                        href={`/api/auth/meta/start?profileId=${profile.id}`}
                        className="inline-flex h-9 items-center justify-center rounded-[var(--radius-button)] border border-border bg-surface-2 px-3 text-sm font-medium text-text transition-colors duration-[var(--motion-fast)] hover:border-border-strong"
                      >
                        Adicionar conta Instagram
                      </a>
                    )}
                  </div>

                  {profileAccounts.length > 0 && (
                    <ul className="mt-2 divide-y divide-border-subtle border-y border-border-subtle">
                      {profileAccounts.map((account) => (
                        <AccountRow key={account.id} account={account} />
                      ))}
                    </ul>
                  )}

                  {activeCount > 0 && profileAccounts.length > 0 && (
                    <p className="mt-2 text-xs text-text-muted">
                      {activeCount} {activeCount === 1 ? "automação ativa" : "automações ativas"} neste perfil
                      {profileAccounts.length > 1 ? " — valem para todas as contas acima." : "."}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
