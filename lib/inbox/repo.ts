import type { SupabaseClient } from "@supabase/supabase-js";

export type ConversationRow = {
  id: string;
  workspace_id: string;
  social_account_id: string;
  contact_id: string;
  status: string;
  automation_enabled: boolean;
};

/** Conversa pertence ao workspace? Nunca confiar em conversationId vindo do client sem validar (docs/PITCHAT_ARCHITECTURE.md §4). */
export async function loadConversationForWorkspace(
  admin: SupabaseClient,
  conversationId: string,
  workspaceId: string
): Promise<ConversationRow | null> {
  const { data } = await admin
    .from("conversations")
    .select("id, workspace_id, social_account_id, contact_id, status, automation_enabled")
    .eq("id", conversationId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  return data as ConversationRow | null;
}
