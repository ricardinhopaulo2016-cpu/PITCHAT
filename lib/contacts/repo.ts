import type { SupabaseClient } from "@supabase/supabase-js";

const LIST_LIMIT = 100;

export type ContactListItem = {
  id: string;
  username: string | null;
  /** `contacts.avatar_url` — null hoje (sem enrichment); a UI cai pra iniciais. */
  avatarUrl: string | null;
  platform: string;
  firstSeenAt: string;
  lastSeenAt: string;
  socialAccountUsername: string | null;
  tags: string[];
};

/** Lista contatos do workspace — 3-4 queries fixas (contacts, [channel scoping], conversations+social_account, contact_tags), nunca N+1. */
export async function listContacts(
  admin: SupabaseClient,
  workspaceId: string,
  opts: { socialAccountId?: string | null } = {}
): Promise<ContactListItem[]> {
  let query = admin
    .from("contacts")
    .select("id, username, avatar_url, platform, first_seen_at, last_seen_at")
    .eq("workspace_id", workspaceId);

  // Filtro do Channel Switcher (D1): resolve pra "contatos com >=1 conversation
  // nesse social_account" ANTES do .limit() — nunca buscar os 100 mais
  // recentes de todo o workspace e filtrar depois em JS (cortaria contatos
  // reais do canal que não estivessem entre os 100 mais recentes globais).
  if (opts.socialAccountId) {
    const { data: channelConversations } = await admin
      .from("conversations")
      .select("contact_id")
      .eq("workspace_id", workspaceId)
      .eq("social_account_id", opts.socialAccountId)
      .limit(LIST_LIMIT);
    const channelContactIds = [...new Set((channelConversations ?? []).map((c) => c.contact_id as string))];
    if (channelContactIds.length === 0) return []; // canal sem nenhum contato ainda — nunca ambia pra "todos"
    query = query.in("id", channelContactIds);
  }

  const { data: contacts } = await query.order("last_seen_at", { ascending: false }).limit(LIST_LIMIT);

  if (!contacts || contacts.length === 0) return [];
  const contactIds = contacts.map((c) => c.id as string);

  const [{ data: conversations }, { data: contactTags }] = await Promise.all([
    admin
      .from("conversations")
      .select("contact_id, updated_at, social_account:social_accounts(username)")
      .in("contact_id", contactIds)
      .order("updated_at", { ascending: false }),
    admin.from("contact_tags").select("contact_id, tags(name)").in("contact_id", contactIds),
  ]);

  const socialAccountByContact = new Map<string, string | null>();
  for (const c of conversations ?? []) {
    if (!socialAccountByContact.has(c.contact_id as string)) {
      socialAccountByContact.set(c.contact_id as string, (c.social_account as unknown as { username: string | null } | null)?.username ?? null);
    }
  }
  const tagsByContact = new Map<string, string[]>();
  for (const t of contactTags ?? []) {
    const name = (t.tags as unknown as { name: string } | null)?.name;
    if (!name) continue;
    const list = tagsByContact.get(t.contact_id as string) ?? [];
    list.push(name);
    tagsByContact.set(t.contact_id as string, list);
  }

  return contacts.map((c) => ({
    id: c.id as string,
    username: c.username as string | null,
    avatarUrl: c.avatar_url as string | null,
    platform: c.platform as string,
    firstSeenAt: c.first_seen_at as string,
    lastSeenAt: c.last_seen_at as string,
    socialAccountUsername: socialAccountByContact.get(c.id as string) ?? null,
    tags: tagsByContact.get(c.id as string) ?? [],
  }));
}

export type ContactDetail = ContactListItem & {
  conversations: {
    id: string;
    /** Pra montar o link de volta pro Inbox com o channel certo (D1) — nunca inferir pelo username. */
    socialAccountId: string;
    socialAccountUsername: string | null;
    lastMessageAt: string | null;
    automationEnabled: boolean;
  }[];
  customFields: { key: string; label: string; value: unknown }[];
};

/** Contato pertence ao workspace? Nunca confiar em contactId vindo do client sem validar (docs/PITCHAT_ARCHITECTURE.md §4). */
export async function loadContactDetail(admin: SupabaseClient, contactId: string, workspaceId: string): Promise<ContactDetail | null> {
  const { data: contact } = await admin
    .from("contacts")
    .select("id, username, avatar_url, platform, first_seen_at, last_seen_at")
    .eq("id", contactId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!contact) return null;

  const [{ data: conversations }, { data: contactTags }, { data: customFieldValues }] = await Promise.all([
    admin
      .from("conversations")
      .select("id, social_account_id, last_message_at, automation_enabled, social_account:social_accounts(username)")
      .eq("contact_id", contactId)
      .order("updated_at", { ascending: false }),
    admin.from("contact_tags").select("tags(name)").eq("contact_id", contactId),
    admin.from("custom_field_values").select("value, field:custom_field_definitions(key, label)").eq("contact_id", contactId),
  ]);

  return {
    id: contact.id,
    username: contact.username,
    avatarUrl: contact.avatar_url as string | null,
    platform: contact.platform,
    firstSeenAt: contact.first_seen_at,
    lastSeenAt: contact.last_seen_at,
    socialAccountUsername: (conversations?.[0]?.social_account as unknown as { username: string | null } | null)?.username ?? null,
    tags: (contactTags ?? []).map((t) => (t.tags as unknown as { name: string } | null)?.name).filter((n): n is string => !!n),
    conversations: (conversations ?? []).map((c) => ({
      id: c.id as string,
      socialAccountId: c.social_account_id as string,
      socialAccountUsername: (c.social_account as unknown as { username: string | null } | null)?.username ?? null,
      lastMessageAt: c.last_message_at as string | null,
      automationEnabled: c.automation_enabled !== false,
    })),
    customFields: (customFieldValues ?? []).map((v) => {
      const field = v.field as unknown as { key: string; label: string } | null;
      return { key: field?.key ?? "?", label: field?.label ?? "?", value: v.value };
    }),
  };
}
