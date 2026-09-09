import type { SupabaseClient } from "@supabase/supabase-js";

export type MediaStats = {
  ready: number;
  processing: number; // pending + processing (ainda não terminou)
  failed: number;
};

/**
 * Contagens reais pro dashboard. 'duplicate' fica de fora de propósito — é
 * só um registro interno de log (ver migration 0003), não uma mídia real da
 * biblioteca.
 */
export async function getMediaStats(
  admin: SupabaseClient,
  workspaceId: string
): Promise<MediaStats> {
  const { data, error } = await admin
    .from("media_assets")
    .select("status")
    .eq("workspace_id", workspaceId)
    .neq("status", "duplicate");

  if (error || !data) {
    return { ready: 0, processing: 0, failed: 0 };
  }

  return data.reduce(
    (acc, row) => {
      if (row.status === "ready") acc.ready++;
      else if (row.status === "pending" || row.status === "processing") acc.processing++;
      else if (row.status === "failed") acc.failed++;
      return acc;
    },
    { ready: 0, processing: 0, failed: 0 }
  );
}
