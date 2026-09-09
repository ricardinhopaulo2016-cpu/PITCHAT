import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { needsRefresh } from "@/lib/meta/oauth";
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

  const accountByProfile = new Map((socialAccounts ?? []).map((sa) => [sa.profile_id, sa]));

  return (
    <main className="mx-auto max-w-2xl px-6 py-12">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Social Accounts</h1>
        <Link href="/dashboard" className="text-sm underline opacity-70">
          Voltar
        </Link>
      </div>

      {status === "connected" && (
        <p className="mb-4 rounded border border-green-200 bg-green-50 p-3 text-sm text-green-800">
          Instagram conectado com sucesso.
        </p>
      )}
      {status === "error" && (
        <p className="mb-4 rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          Não foi possível conectar o Instagram{detail ? ` (${detail})` : ""}.
        </p>
      )}

      {!profiles || profiles.length === 0 ? (
        <p className="text-sm opacity-60">
          Nenhum perfil cadastrado ainda. Crie um em <code>profiles</code> antes de conectar uma
          conta do Instagram.
        </p>
      ) : (
        <ul className="divide-y">
          {profiles.map((profile) => {
            const account = accountByProfile.get(profile.id);
            const expiringSoon =
              account?.token_expires_at && needsRefresh(new Date(account.token_expires_at));

            return (
              <li key={profile.id} className="flex items-center justify-between gap-4 py-4">
                <div>
                  <p className="font-medium">{profile.name}</p>
                  {account ? (
                    <p className="text-sm opacity-60">
                      Instagram: {account.username ? `@${account.username}` : "(sem username)"} ·{" "}
                      <span
                        className={
                          account.status === "connected" ? "text-green-700" : "text-amber-600"
                        }
                      >
                        {STATUS_LABEL[account.status] ?? account.status}
                      </span>
                      {expiringSoon && " · token expira em breve"}
                    </p>
                  ) : (
                    <p className="text-sm opacity-60">Nenhuma conta do Instagram conectada.</p>
                  )}
                </div>

                {account && account.status === "connected" ? (
                  <div className="flex gap-3">
                    <a
                      href={`/api/auth/meta/start?profileId=${profile.id}`}
                      className="text-sm underline"
                    >
                      Reconectar
                    </a>
                    <DisconnectButton socialAccountId={account.id} />
                  </div>
                ) : (
                  <a
                    href={`/api/auth/meta/start?profileId=${profile.id}`}
                    className="rounded border px-3 py-1.5 text-sm hover:bg-gray-50"
                  >
                    Connect Instagram
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
