import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspace, type Workspace } from "@/lib/workspace";

export type AuthContext = {
  userId: string;
  email: string | null;
  workspace: Workspace;
};

/**
 * Resolve quem está logado e em qual workspace, pra usar no início de toda
 * Route Handler que mexe em dado de domínio. Retorna null em qualquer
 * situação que devia virar 401/403 — nunca lança, pra não vazar stack trace
 * pro cliente; quem chama decide o status code.
 */
export async function getAuthContext(): Promise<AuthContext | null> {
  const supabase = await getSupabaseServerClient();
  if (!supabase) return null;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const workspace = await getCurrentWorkspace(user.id);
  if (!workspace) return null;

  return { userId: user.id, email: user.email ?? null, workspace };
}
