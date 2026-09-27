import type { SupabaseClient } from "@supabase/supabase-js";

const ACCOUNTS_LIMIT = 100; // teto — contas por workspace são poucas, mas nunca select sem limite

export type ChannelAccount = {
  id: string;
  username: string | null;
  status: string;
  profileId: string;
  profileName: string;
};

const CHANNEL_COLUMNS = "id, username, status, profile_id, profile:profiles(name)";

function toChannelAccount(row: Record<string, unknown>): ChannelAccount {
  const profile = row.profile as { name: string } | null;
  return {
    id: row.id as string,
    username: row.username as string | null,
    status: row.status as string,
    profileId: row.profile_id as string,
    profileName: profile?.name ?? "Perfil",
  };
}

/**
 * Todas as contas Instagram não-revogadas do workspace, com o nome do
 * profile já embutido (1 query, sem N+1) — é o dado real do Channel Switcher
 * (D1) e do contexto de canal no mobile. Nunca colapsa por profile: um
 * profile pode ter várias contas (Fase D0).
 */
export async function listWorkspaceChannelAccounts(admin: SupabaseClient, workspaceId: string): Promise<ChannelAccount[]> {
  const { data } = await admin
    .from("social_accounts")
    .select(CHANNEL_COLUMNS)
    .eq("workspace_id", workspaceId)
    .eq("platform", "instagram")
    .neq("status", "revoked")
    .order("created_at", { ascending: true })
    .limit(ACCOUNTS_LIMIT);
  return (data ?? []).map(toChannelAccount);
}

export type ChannelProfileGroup = { profileId: string; profileName: string; accounts: ChannelAccount[] };

/** Agrupa por profile pra exibição (heading discreto, não accordion) — preserva a ordem de entrada, nunca perde conta. */
export function groupChannelAccountsByProfile(accounts: ChannelAccount[]): ChannelProfileGroup[] {
  const groups: ChannelProfileGroup[] = [];
  const byProfile = new Map<string, ChannelProfileGroup>();
  for (const account of accounts) {
    let group = byProfile.get(account.profileId);
    if (!group) {
      group = { profileId: account.profileId, profileName: account.profileName, accounts: [] };
      byProfile.set(account.profileId, group);
      groups.push(group);
    }
    group.accounts.push(account);
  }
  return groups;
}

/**
 * Normaliza o param `channel` da URL: ausente ou `"all"` (valor legado/
 * canônico de "todos os canais") viram `null`. Qualquer outra string segue
 * como candidato a UUID de `social_accounts.id` — a validação real é
 * `resolveChannel`, nunca confiar no formato.
 */
export function normalizeChannelParam(raw: string | string[] | undefined | null): string | null {
  if (!raw || Array.isArray(raw)) return null;
  return raw === "all" ? null : raw;
}

/**
 * Resolve e valida um channel vindo da URL: precisa existir, pertencer ao
 * workspace autenticado, ser Instagram e não estar revoked. Nunca confiar
 * cegamente no UUID — um channel inválido some do resultado (null), nunca
 * amplia silenciosamente pra "todos os canais" (docs/PITCHAT_ARCHITECTURE.md
 * §4: nunca confiar em id vindo do client sem validar).
 */
export async function resolveChannel(admin: SupabaseClient, workspaceId: string, channelId: string): Promise<ChannelAccount | null> {
  const { data } = await admin
    .from("social_accounts")
    .select(CHANNEL_COLUMNS)
    .eq("id", channelId)
    .eq("workspace_id", workspaceId)
    .eq("platform", "instagram")
    .neq("status", "revoked")
    .maybeSingle();
  return data ? toChannelAccount(data) : null;
}
