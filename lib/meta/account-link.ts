/**
 * Decisão pura do callback do OAuth: dado quem foi autorizado na Meta, o que
 * fazer com `social_accounts`? Existe pra que "adicionar IG02" e "reconectar
 * IG01" nunca sobrescrevam/reassociem uma conta por acidente (Fase D0).
 *
 * Contexto: `social_accounts` é único por (platform, external_account_id) e
 * um profile pode ter várias contas. O upsert antigo reescrevia
 * `workspace_id`/`profile_id` da linha existente — reconectar (ou autorizar
 * outra conta no navegador) podia MOVER uma conta de perfil em silêncio.
 * Agora a linha existente só tem token/status atualizados, nunca
 * profile/workspace.
 */
export type LinkableAccount = { id: string; workspace_id: string; profile_id: string; external_account_id: string };

export type AccountLinkDecision =
  | { action: "insert" }
  | { action: "update"; accountId: string }
  | { action: "reject"; reason: AccountLinkRejection };

export type AccountLinkRejection =
  | "wrong_account_authorized" // reconexão de A, mas a Meta devolveu B
  | "reconnect_target_not_found"
  | "account_in_other_workspace"
  | "account_linked_to_other_profile";

export function decideAccountLink(input: {
  workspaceId: string;
  profileId: string;
  /** Identidade REAL autorizada (`GET /me` → user_id), nunca o id app-scoped. */
  authorizedExternalId: string;
  /** Linha existente com (platform, external_account_id) = identidade autorizada, em qualquer workspace. */
  existing: LinkableAccount | null;
  /** Só em "reconectar": a conta-alvo (já validada por workspace+profile no start). `undefined` = fluxo "adicionar". */
  reconnectTarget?: LinkableAccount | null;
  reconnectRequested?: boolean;
}): AccountLinkDecision {
  const { workspaceId, profileId, authorizedExternalId, existing, reconnectTarget, reconnectRequested } = input;

  if (reconnectRequested) {
    if (!reconnectTarget) return { action: "reject", reason: "reconnect_target_not_found" };
    if (reconnectTarget.external_account_id !== authorizedExternalId) return { action: "reject", reason: "wrong_account_authorized" };
  }

  if (existing) {
    if (existing.workspace_id !== workspaceId) return { action: "reject", reason: "account_in_other_workspace" };
    if (existing.profile_id !== profileId) return { action: "reject", reason: "account_linked_to_other_profile" };
    return { action: "update", accountId: existing.id };
  }

  return { action: "insert" };
}
