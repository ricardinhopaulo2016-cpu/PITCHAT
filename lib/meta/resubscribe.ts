import type { SupabaseClient } from "@supabase/supabase-js";
import { subscribeAccountToWebhooks } from "./oauth";
import { decryptToken } from "./token-crypto";

const ACCOUNTS_LIMIT = 100; // contas por workspace são poucas, mas nunca select sem limite

export type ResubscribeResult = {
  accountId: string;
  username: string | null;
  status: "ok" | "failed" | "skipped";
  detail: string;
};

type AccountRow = {
  id: string;
  username: string | null;
  status: string;
  external_account_id: string;
  access_token_encrypted: string | null;
};

/**
 * Refaz a assinatura de webhook das contas do workspace com a lista atual de
 * eventos, sem precisar reconectar. Uma conta com problema nunca impede as
 * outras. O resultado volta para o navegador: nunca leva token nem erro bruto,
 * porque a URL da chamada à Meta contém o token.
 */
export async function resubscribeWorkspaceWebhooks(
  admin: SupabaseClient,
  workspaceId: string,
  deps: { subscribe: typeof subscribeAccountToWebhooks; decrypt: typeof decryptToken } = {
    subscribe: subscribeAccountToWebhooks,
    decrypt: decryptToken,
  }
): Promise<ResubscribeResult[]> {
  const { data, error } = await admin
    .from("social_accounts")
    .select("id, username, status, external_account_id, access_token_encrypted")
    .eq("workspace_id", workspaceId)
    .eq("platform", "instagram")
    .neq("status", "revoked")
    .limit(ACCOUNTS_LIMIT);
  if (error) throw new Error("Falha ao carregar as contas do workspace");

  const results: ResubscribeResult[] = [];
  for (const account of (data ?? []) as AccountRow[]) {
    const base = { accountId: account.id, username: account.username };

    if (account.status !== "connected" || !account.access_token_encrypted) {
      results.push({ ...base, status: "skipped", detail: "Conta sem conexão ativa. Reconecte para receber os eventos." });
      continue;
    }

    try {
      const ok = await deps.subscribe(deps.decrypt(account.access_token_encrypted), account.external_account_id);
      results.push(
        ok
          ? { ...base, status: "ok", detail: "Assinatura atualizada." }
          : { ...base, status: "failed", detail: "A Meta recusou. Confira se messaging_seen está marcado no painel do app." }
      );
    } catch {
      results.push({ ...base, status: "failed", detail: "Não foi possível falar com a Meta. Tente de novo." });
    }
  }
  return results;
}
