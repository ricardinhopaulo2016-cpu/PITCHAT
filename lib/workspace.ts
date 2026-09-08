import { getSupabaseAdminClient } from "@/lib/supabase/admin";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
};

/**
 * V1 simplification: resolves the user's first workspace membership
 * (ordered by joined_at), not a full workspace switcher. Fine while each
 * person operates in a single workspace; revisit when that stops being true
 * (add a workspace switcher + a "current workspace" cookie).
 */
export async function getCurrentWorkspace(userId: string): Promise<Workspace | null> {
  const admin = getSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin
    .from("workspace_members")
    .select("workspace:workspaces(id, name, slug)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;

  // Supabase's generated types would type `workspace` as an array here without
  // codegen; at runtime a to-one FK relation returns a single object.
  return (data as unknown as { workspace: Workspace }).workspace ?? null;
}
