import type { SupabaseClient } from "@supabase/supabase-js";

export type ExactDuplicateCheck =
  | { isDuplicate: true; existingAssetId: string }
  | { isDuplicate: false };

/**
 * Duplicata exata = mesmo sha256 dentro do MESMO workspace (workspace_id +
 * sha256, só entre linhas status='ready' — ver migration 0003). Nunca
 * considera o filename. Dois workspaces podem ter o mesmo conteúdo sem
 * conflito nenhum — a Media Library é isolada por workspace.
 */
export async function findExactDuplicate(
  admin: SupabaseClient,
  workspaceId: string,
  sha256: string
): Promise<ExactDuplicateCheck> {
  const { data, error } = await admin
    .from("media_assets")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("sha256", sha256)
    .eq("status", "ready")
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Falha ao checar duplicata exata: ${error.message}`);
  }

  return data ? { isDuplicate: true, existingAssetId: data.id } : { isDuplicate: false };
}
