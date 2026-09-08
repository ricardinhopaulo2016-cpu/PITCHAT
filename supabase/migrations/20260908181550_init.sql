-- PITCHAT — migration 0001: schema inicial (Fase 1: fundação)
-- Aplicada via `supabase db push` (fonte de verdade — ver supabase/README.md).
-- Convenções: uuid PK (gen_random_uuid()), timestamptz, workspace_id em toda tabela
-- de domínio, RLS habilitado em tudo (service_role do backend ignora RLS, mas os
-- handlers ainda precisam filtrar por workspace_id manualmente — ver
-- docs/PITCHAT_ARCHITECTURE.md §4).

create extension if not exists pgcrypto;

-- ============================================================================
-- 1. WORKSPACE / MEMBROS
-- ============================================================================

create table if not exists workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  created_at timestamptz not null default now(),
  unique (workspace_id, user_id)
);

-- ============================================================================
-- 2. PROFILES (persona configurável — NUNCA hardcode nome de perfil em código)
-- ============================================================================

create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  slug text not null,
  persona_description text,
  avatar_url text,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  timezone text not null default 'America/Sao_Paulo',
  default_cta text,
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

-- ============================================================================
-- 3. SOCIAL ACCOUNTS
-- ============================================================================

create table if not exists social_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  platform text not null default 'instagram' check (platform in ('instagram')),
  external_account_id text not null,
  username text,
  display_name text,
  avatar_url text,
  access_token_encrypted text,
  token_expires_at timestamptz,
  permissions text[] not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'connected', 'expired', 'revoked', 'error')),
  status_detail text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_account_id)
);

-- ============================================================================
-- 4. CONTACTS / CONVERSATIONS / MESSAGES / COMMENTS
-- ============================================================================

create table if not exists contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  platform text not null default 'instagram',
  platform_user_id text not null, -- IGSID
  username text,
  display_name text,
  avatar_url text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (workspace_id, platform, platform_user_id)
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  contact_id uuid not null references contacts(id) on delete cascade,
  status text not null default 'open' check (status in ('open', 'closed')),
  automation_enabled boolean not null default true,
  assigned_to uuid references auth.users(id),
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (social_account_id, contact_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  conversation_id uuid not null references conversations(id) on delete cascade,
  external_message_id text,
  direction text not null check (direction in ('inbound', 'outbound')),
  origin text not null default 'automation' check (origin in ('automation', 'manual')),
  type text not null default 'text' check (type in ('text', 'button', 'quick_reply', 'image', 'link', 'system')),
  text text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'failed')),
  error jsonb,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  contact_id uuid references contacts(id) on delete set null,
  external_comment_id text not null,
  external_media_id text,
  parent_comment_id text,
  text text,
  raw_payload jsonb not null default '{}'::jsonb,
  automation_processed_at timestamptz,
  matched_automation_id uuid,
  created_at timestamptz not null default now(),
  unique (social_account_id, external_comment_id)
);

-- ============================================================================
-- 5. AUTOMATIONS (versionadas) / RUNS / STEPS
-- ============================================================================

create table if not exists automations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'archived')),
  current_version_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists automation_versions (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references automations(id) on delete cascade,
  version integer not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  graph jsonb not null default '{"nodes": [], "edges": []}'::jsonb,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  unique (automation_id, version)
);

alter table automations
  add constraint automations_current_version_fk
  foreign key (current_version_id) references automation_versions(id) on delete set null;

create table if not exists automation_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  automation_id uuid not null references automations(id) on delete cascade,
  automation_version_id uuid not null references automation_versions(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  contact_id uuid references contacts(id) on delete set null,
  trigger_source text not null check (trigger_source in ('comment', 'message', 'postback')),
  trigger_ref_id text, -- external_comment_id / external_message_id que disparou
  status text not null default 'running' check (status in ('running', 'waiting', 'completed', 'failed')),
  cursor_node_id text, -- ponto onde retomar depois de um DELAY
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists automation_run_steps (
  id uuid primary key default gen_random_uuid(),
  automation_run_id uuid not null references automation_runs(id) on delete cascade,
  node_id text not null,
  node_type text not null,
  status text not null check (status in ('pending', 'running', 'succeeded', 'failed', 'skipped')),
  input jsonb,
  output jsonb,
  error jsonb,
  attempt integer not null default 1,
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================================================
-- 6. TAGS / CUSTOM FIELDS
-- ============================================================================

create table if not exists tags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, name)
);

create table if not exists contact_tags (
  contact_id uuid not null references contacts(id) on delete cascade,
  tag_id uuid not null references tags(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (contact_id, tag_id)
);

create table if not exists custom_field_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  key text not null,
  label text not null,
  type text not null check (type in ('text', 'number', 'boolean', 'date', 'datetime')),
  created_at timestamptz not null default now(),
  unique (workspace_id, key)
);

create table if not exists custom_field_values (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references contacts(id) on delete cascade,
  field_id uuid not null references custom_field_definitions(id) on delete cascade,
  value jsonb,
  updated_at timestamptz not null default now(),
  unique (contact_id, field_id)
);

-- ============================================================================
-- 7. WEBHOOK EVENTS (brutos, idempotentes)
-- ============================================================================

create table if not exists webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'meta',
  external_event_id text not null,
  event_type text not null,
  social_account_id uuid references social_accounts(id) on delete set null,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'pending' check (status in ('pending', 'processing', 'processed', 'failed')),
  attempts integer not null default 0,
  last_error jsonb,
  unique (provider, external_event_id)
);

-- ============================================================================
-- 8. JOBS (espelho local do que foi enfileirado no Upstash QStash — auditoria/retry)
-- ============================================================================

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references workspaces(id) on delete cascade,
  type text not null, -- ex: 'process_webhook_event', 'resume_automation_run'
  payload jsonb not null default '{}'::jsonb,
  qstash_message_id text,
  run_at timestamptz not null default now(),
  status text not null default 'scheduled' check (status in ('scheduled', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0,
  last_error jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

-- ============================================================================
-- 9. MEDIA LIBRARY
-- ============================================================================

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  original_filename text, -- só para referência humana, NUNCA usado como identidade
  storage_key text not null,
  source_type text not null check (source_type in ('upload', 'google_drive')),
  source_external_id text,
  sha256 text not null,
  file_size bigint,
  mime_type text,
  duration_ms integer,
  width integer,
  height integer,
  fps numeric,
  codec text,
  bitrate integer,
  has_audio boolean,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, sha256)
);

create table if not exists media_fingerprints (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references media_assets(id) on delete cascade,
  kind text not null check (kind in ('video_phash', 'audio_fingerprint')),
  fingerprint jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists media_usage (
  id uuid primary key default gen_random_uuid(),
  media_asset_id uuid not null references media_assets(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  platform text not null,
  context text,
  external_reference text,
  used_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb
);

create table if not exists media_duplicate_reviews (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  asset_a_id uuid not null references media_assets(id) on delete cascade,
  asset_b_id uuid not null references media_assets(id) on delete cascade,
  visual_similarity numeric,
  audio_similarity numeric,
  decision text check (decision in ('same_content', 'different', 'ignored')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (asset_a_id, asset_b_id)
);

-- ============================================================================
-- 10. LINKS / UTM
-- ============================================================================

create table if not exists links (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  profile_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  base_url text not null,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content_template text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================================
-- 11. AUDIT LOG
-- ============================================================================

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text,
  entity_id text,
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);

-- ============================================================================
-- 12. ÍNDICES
-- ============================================================================

create index if not exists idx_profiles_workspace on profiles(workspace_id);
create index if not exists idx_social_accounts_workspace on social_accounts(workspace_id);
create index if not exists idx_social_accounts_profile on social_accounts(profile_id);
create index if not exists idx_contacts_workspace on contacts(workspace_id);
create index if not exists idx_conversations_workspace on conversations(workspace_id);
create index if not exists idx_conversations_contact on conversations(contact_id);
create index if not exists idx_messages_conversation on messages(conversation_id);
create index if not exists idx_comments_social_account on comments(social_account_id);
create index if not exists idx_automations_workspace on automations(workspace_id);
create index if not exists idx_automation_runs_automation on automation_runs(automation_id);
create index if not exists idx_automation_runs_conversation on automation_runs(conversation_id);
create index if not exists idx_automation_run_steps_run on automation_run_steps(automation_run_id);
create index if not exists idx_webhook_events_status on webhook_events(status);
create index if not exists idx_jobs_status_run_at on jobs(status, run_at);
create index if not exists idx_media_assets_workspace on media_assets(workspace_id);
create index if not exists idx_media_assets_sha256 on media_assets(sha256);
create index if not exists idx_media_usage_asset on media_usage(media_asset_id);
create index if not exists idx_media_usage_profile on media_usage(profile_id);

-- ============================================================================
-- 13. RLS — defesa em profundidade (o backend usa service_role e AINDA
-- precisa validar workspace_id no handler; RLS é a segunda barreira, não a única)
-- ============================================================================

create or replace function is_workspace_member(ws_id uuid)
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = ws_id and user_id = auth.uid()
  );
$$;

alter table workspaces enable row level security;
alter table workspace_members enable row level security;
alter table profiles enable row level security;
alter table social_accounts enable row level security;
alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table comments enable row level security;
alter table automations enable row level security;
alter table automation_versions enable row level security;
alter table automation_runs enable row level security;
alter table automation_run_steps enable row level security;
alter table tags enable row level security;
alter table contact_tags enable row level security;
alter table custom_field_definitions enable row level security;
alter table custom_field_values enable row level security;
alter table webhook_events enable row level security;
alter table jobs enable row level security;
alter table media_assets enable row level security;
alter table media_fingerprints enable row level security;
alter table media_usage enable row level security;
alter table media_duplicate_reviews enable row level security;
alter table links enable row level security;
alter table audit_logs enable row level security;

create policy workspace_members_select on workspaces
  for select using (is_workspace_member(id));

-- Antes: só enxergava a própria linha de membership (quebrava qualquer UI de
-- "atribuir conversa a um colega"). Corrigido: vê todos os membros dos
-- workspaces em que também é membro — nunca membros de outro workspace.
create policy workspace_members_by_workspace on workspace_members
  for select using (is_workspace_member(workspace_id));

create policy profiles_by_workspace on profiles
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy social_accounts_by_workspace on social_accounts
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy contacts_by_workspace on contacts
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy conversations_by_workspace on conversations
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy messages_by_workspace on messages
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy comments_by_workspace on comments
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy automations_by_workspace on automations
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy automation_versions_by_automation on automation_versions
  for all using (
    exists (select 1 from automations a where a.id = automation_id and is_workspace_member(a.workspace_id))
  )
  with check (
    exists (select 1 from automations a where a.id = automation_id and is_workspace_member(a.workspace_id))
  );

create policy automation_runs_by_workspace on automation_runs
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy automation_run_steps_by_run on automation_run_steps
  for all using (
    exists (select 1 from automation_runs r where r.id = automation_run_id and is_workspace_member(r.workspace_id))
  )
  with check (
    exists (select 1 from automation_runs r where r.id = automation_run_id and is_workspace_member(r.workspace_id))
  );

create policy tags_by_workspace on tags
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy contact_tags_by_contact on contact_tags
  for all using (
    exists (select 1 from contacts c where c.id = contact_id and is_workspace_member(c.workspace_id))
  )
  with check (
    exists (select 1 from contacts c where c.id = contact_id and is_workspace_member(c.workspace_id))
  );

create policy custom_field_definitions_by_workspace on custom_field_definitions
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy custom_field_values_by_contact on custom_field_values
  for all using (
    exists (select 1 from contacts c where c.id = contact_id and is_workspace_member(c.workspace_id))
  )
  with check (
    exists (select 1 from contacts c where c.id = contact_id and is_workspace_member(c.workspace_id))
  );

-- webhook_events e jobs são tabelas de plumbing interno (só o backend, via
-- service_role, deveria tocar nelas). Antes a política deixava uma linha com
-- social_account_id/workspace_id NULL visível para QUALQUER usuário
-- autenticado — closed agora: nenhuma policy permissiva para authenticated/anon,
-- ou seja, acesso negado por padrão (service_role sempre ignora RLS).
create policy webhook_events_deny_client on webhook_events
  for all using (false) with check (false);

create policy jobs_deny_client on jobs
  for all using (false) with check (false);

create policy media_assets_by_workspace on media_assets
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy media_fingerprints_by_asset on media_fingerprints
  for all using (
    exists (select 1 from media_assets m where m.id = media_asset_id and is_workspace_member(m.workspace_id))
  )
  with check (
    exists (select 1 from media_assets m where m.id = media_asset_id and is_workspace_member(m.workspace_id))
  );

create policy media_usage_by_asset on media_usage
  for all using (
    exists (select 1 from media_assets m where m.id = media_asset_id and is_workspace_member(m.workspace_id))
  )
  with check (
    exists (select 1 from media_assets m where m.id = media_asset_id and is_workspace_member(m.workspace_id))
  );

create policy media_duplicate_reviews_by_workspace on media_duplicate_reviews
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy links_by_workspace on links
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create policy audit_logs_by_workspace on audit_logs
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));
