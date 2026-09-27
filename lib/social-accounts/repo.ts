import type { SupabaseClient } from "@supabase/supabase-js";

const ACCOUNTS_LIMIT = 100; // teto — contas por workspace são poucas, mas nunca select sem limite

export type InstagramAccount = {
  id: string;
  profile_id: string;
  username: string | null;
  status: string;
  status_detail: string | null;
  token_expires_at: string | null;
};

const COLUMNS = "id, profile_id, username, status, status_detail, token_expires_at";

/** Todas as contas Instagram não-revogadas do workspace — NUNCA colapsa por profile (um profile pode ter várias). */
export async function listWorkspaceInstagramAccounts(admin: SupabaseClient, workspaceId: string): Promise<InstagramAccount[]> {
  const { data } = await admin
    .from("social_accounts")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("platform", "instagram")
    .neq("status", "revoked")
    .order("created_at", { ascending: true })
    .limit(ACCOUNTS_LIMIT);
  return (data ?? []) as InstagramAccount[];
}

/** Contas Instagram não-revogadas de UM profile — lista, nunca `.maybeSingle()` (falha com 2+ linhas). */
export async function listProfileInstagramAccounts(
  admin: SupabaseClient,
  workspaceId: string,
  profileId: string
): Promise<InstagramAccount[]> {
  const { data } = await admin
    .from("social_accounts")
    .select(COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("profile_id", profileId)
    .eq("platform", "instagram")
    .neq("status", "revoked")
    .order("created_at", { ascending: true })
    .limit(ACCOUNTS_LIMIT);
  return (data ?? []) as InstagramAccount[];
}

/** Agrupa por profile preservando TODAS as contas e a ordem de entrada. */
export function groupAccountsByProfile(accounts: InstagramAccount[]): Map<string, InstagramAccount[]> {
  const grouped = new Map<string, InstagramAccount[]>();
  for (const a of accounts) {
    const list = grouped.get(a.profile_id) ?? [];
    list.push(a);
    grouped.set(a.profile_id, list);
  }
  return grouped;
}

/** O mínimo que o editor de automação precisa saber das contas do perfil. */
export type ProfileAccountSummary = Pick<InstagramAccount, "username" | "status">;
