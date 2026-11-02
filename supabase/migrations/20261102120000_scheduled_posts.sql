-- PITCHAT: publicação e agendamento de Reels e Stories no Instagram.
--
-- Uma linha = uma peça para uma conta. Um lote (mesma mídia em várias contas)
-- compartilha batch_id; cada conta tem legenda, horário e status próprios.
create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  -- restrict: apagar a mídia não pode sumir com post agendado sem ninguém ver.
  media_asset_id uuid not null references media_assets(id) on delete restrict,
  batch_id uuid,
  media_type text not null check (media_type in ('REELS', 'STORIES')),
  caption text,
  share_to_feed boolean not null default true,
  scheduled_at timestamptz not null,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'processing', 'published', 'failed', 'canceled')),
  container_id text,
  -- Preenchido antes de chamar media_publish. Se a resposta se perder, o retry
  -- reaproveita o container e descobre pelo status se o post já saiu.
  publish_attempted_at timestamptz,
  external_media_id text,
  permalink text,
  attempts integer not null default 0,
  status_checks integer not null default 0,
  last_error jsonb,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_scheduled_posts_workspace_time on scheduled_posts(workspace_id, scheduled_at desc);
create index if not exists idx_scheduled_posts_due on scheduled_posts(status, scheduled_at);
create index if not exists idx_scheduled_posts_account_time on scheduled_posts(social_account_id, scheduled_at);

alter table scheduled_posts enable row level security;

drop policy if exists scheduled_posts_by_workspace on scheduled_posts;
create policy scheduled_posts_by_workspace on scheduled_posts
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));
