-- Passo 4 da ordem (10/11): medição do funil e das métricas dos Reels.
--
-- 1) link_clicks: cada visita ao redirecionador /r/ do botão de link da DM.
--    Robôs (prévia de link da Meta) ficam gravados com is_bot e não contam.
-- 2) A coorte de pedidos ganha has_tap (tocou na resposta rápida) e has_click
--    (clicou no link), e o funil soma "tapped" e "clicked". A função muda de
--    formato, por isso é recriada.
-- 3) reel_insight_snapshots: views, alcance e interações de cada Reel em
--    idades fixas (1h, 3h, 6h, 24h, 48h, 72h, 7d), para comparar ritmo.

create table if not exists link_clicks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  automation_run_id uuid not null references automation_runs(id) on delete cascade,
  node_id text not null,
  clicked_at timestamptz not null default now(),
  is_bot boolean not null default false,
  user_agent text
);
create index if not exists idx_link_clicks_run on link_clicks (automation_run_id);
create index if not exists idx_link_clicks_workspace_time on link_clicks (workspace_id, clicked_at);
alter table link_clicks enable row level security;
drop policy if exists link_clicks_member on link_clicks;
create policy link_clicks_member on link_clicks
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

create table if not exists reel_insight_snapshots (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  social_account_id uuid not null references social_accounts(id) on delete cascade,
  external_media_id text not null,
  published_at timestamptz not null,
  -- Idade-alvo do snapshot em horas (1, 3, 6, 24, 48, 72, 168).
  age_hours integer not null,
  captured_at timestamptz not null default now(),
  views bigint,
  reach bigint,
  likes bigint,
  comments bigint,
  shares bigint,
  saved bigint,
  total_interactions bigint,
  avg_watch_time_ms bigint,
  error text,
  unique (social_account_id, external_media_id, age_hours)
);
create index if not exists idx_reel_snapshots_workspace on reel_insight_snapshots (workspace_id, published_at);
alter table reel_insight_snapshots enable row level security;
drop policy if exists reel_insight_snapshots_member on reel_insight_snapshots;
create policy reel_insight_snapshots_member on reel_insight_snapshots
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

drop function if exists metrics_request_cohort(uuid, text, uuid, timestamptz, timestamptz);

create or replace function metrics_request_cohort(
  p_workspace_id uuid, p_phrase text, p_account_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (
  social_account_id uuid,
  external_media_id text,
  author_key text,
  request_comments bigint,
  first_recorded_at timestamptz,
  has_execution boolean,
  first_dm_at timestamptz,
  first_dm_comment_recorded_at timestamptz,
  has_link_button boolean,
  has_quick_reply_button boolean,
  has_tap boolean,
  has_click boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with requests as (
    select f.*
    from metrics_comment_facts(p_workspace_id, p_phrase, p_account_id, p_from, p_to) f
    where f.is_request and f.author_key is not null
  ),
  people as (
    select q.social_account_id, q.external_media_id, q.author_key,
      count(*) as request_comments,
      min(q.recorded_at) as first_recorded_at
    from requests q
    group by q.social_account_id, q.external_media_id, q.author_key
  ),
  linked_runs as (
    select q.social_account_id, q.external_media_id, q.author_key, q.recorded_at as comment_recorded_at, r.id as run_id, r.automation_version_id, r.conversation_id
    from requests q
    join automation_runs r
      on r.workspace_id = p_workspace_id
     and r.trigger_source = 'comment'
     and r.trigger_ref_id = q.external_comment_id
    left join conversations cv on cv.id = r.conversation_id and cv.workspace_id = p_workspace_id
    where (r.conversation_id is null or cv.social_account_id = q.social_account_id)
      and not exists (
        select 1 from automation_run_steps ns
        where ns.automation_run_id = r.id and ns.status = 'succeeded' and ns.output->>'matched' = 'false'
      )
  ),
  executed as (
    select distinct l.social_account_id, l.external_media_id, l.author_key from linked_runs l
  ),
  run_sends as (
    select l.run_id, l.social_account_id, l.external_media_id, l.author_key, l.comment_recorded_at,
      s.started_at, s.node_type, node.value as node
    from linked_runs l
    join automation_run_steps s
      on s.automation_run_id = l.run_id
     and s.status = 'succeeded'
     and s.node_type in ('PRIVATE_REPLY', 'SEND_MESSAGE', 'QUICK_REPLY')
    left join automation_versions v on v.id = l.automation_version_id
    left join lateral (
      select n.value
      from jsonb_array_elements(case when jsonb_typeof(v.graph->'nodes') = 'array' then v.graph->'nodes' else '[]'::jsonb end) n
      where n.value->>'id' = s.node_id
      limit 1
    ) node on true
  ),
  -- A primeira DM da pessoa no post, com o horário do comentário que gerou essa run.
  -- Sem isso a latência subtrairia horários de comentários diferentes.
  first_send as (
    select distinct on (r.social_account_id, r.external_media_id, r.author_key)
      r.social_account_id, r.external_media_id, r.author_key,
      r.started_at as first_dm_at,
      r.comment_recorded_at as first_dm_comment_recorded_at
    from run_sends r
    order by r.social_account_id, r.external_media_id, r.author_key, r.started_at, r.run_id
  ),
  buttons as (
    select r.social_account_id, r.external_media_id, r.author_key,
      coalesce(bool_or(r.node_type = 'SEND_MESSAGE' and jsonb_typeof(r.node->'data'->'button') = 'object'), false) as has_link_button,
      coalesce(bool_or(
        r.node_type = 'QUICK_REPLY'
        or (
          r.node_type = 'PRIVATE_REPLY'
          and jsonb_typeof(r.node->'data'->'quickReplyOptions') = 'array'
          and jsonb_array_length(r.node->'data'->'quickReplyOptions') > 0
        )
      ), false) as has_quick_reply_button
    from run_sends r
    group by r.social_account_id, r.external_media_id, r.author_key
  ),
  -- Toque: a resposta rápida volta com o payload runId:nodeId:opção (lib/automation/engine.ts).
  -- Clique: o link do botão passa por /r/ e grava link_clicks; visita de robô (prévia de link) não conta.
  interactions as (
    select l.social_account_id, l.external_media_id, l.author_key,
      bool_or(exists (
        select 1 from messages m
        where m.conversation_id = l.conversation_id
          and m.workspace_id = p_workspace_id
          and m.direction = 'inbound'
          and m.type = 'quick_reply'
          and m.payload->>'payload' like l.run_id::text || ':%'
      )) as has_tap,
      bool_or(exists (
        select 1 from link_clicks k
        where k.automation_run_id = l.run_id and not k.is_bot
      )) as has_click
    from linked_runs l
    group by l.social_account_id, l.external_media_id, l.author_key
  )
  select p.social_account_id, p.external_media_id, p.author_key, p.request_comments, p.first_recorded_at,
    e.author_key is not null as has_execution,
    f.first_dm_at,
    f.first_dm_comment_recorded_at,
    coalesce(b.has_link_button, false) as has_link_button,
    coalesce(b.has_quick_reply_button, false) as has_quick_reply_button,
    coalesce(i.has_tap, false) as has_tap,
    coalesce(i.has_click, false) as has_click
  from people p
  left join executed e using (social_account_id, external_media_id, author_key)
  left join first_send f using (social_account_id, external_media_id, author_key)
  left join buttons b using (social_account_id, external_media_id, author_key)
  left join interactions i using (social_account_id, external_media_id, author_key);
$$;

create or replace function metrics_funnel(
  p_workspace_id uuid, p_phrase text, p_account_id uuid, p_from timestamptz, p_to timestamptz, p_post_limit integer default 50
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with facts as (
    select * from metrics_comment_facts(p_workspace_id, p_phrase, p_account_id, p_from, p_to)
    where is_valid
  ),
  cohort as (
    select * from metrics_request_cohort(p_workspace_id, p_phrase, p_account_id, p_from, p_to)
  ),
  post_comments as (
    select f.social_account_id, f.external_media_id,
      count(*) as comments_valid,
      count(*) filter (where f.is_request and f.author_key is null) as requests_without_author
    from facts f
    group by f.social_account_id, f.external_media_id
  ),
  post_cohort as (
    select c.social_account_id, c.external_media_id,
      count(*) as requests_unique,
      count(*) filter (where c.has_execution) as executions,
      count(*) filter (where c.first_dm_at is not null) as first_dm,
      count(*) filter (where c.has_link_button or c.has_quick_reply_button) as button,
      count(*) filter (where c.has_link_button) as link_button,
      count(*) filter (where c.has_quick_reply_button) as quick_reply_button,
      count(*) filter (where c.has_tap) as tapped,
      count(*) filter (where c.has_click) as clicked
    from cohort c
    group by c.social_account_id, c.external_media_id
  ),
  posts as (
    select pc.social_account_id, pc.external_media_id, pc.comments_valid, pc.requests_without_author,
      coalesce(cc.requests_unique, 0) as requests_unique,
      coalesce(cc.executions, 0) as executions,
      coalesce(cc.first_dm, 0) as first_dm,
      coalesce(cc.button, 0) as button,
      coalesce(cc.link_button, 0) as link_button,
      coalesce(cc.quick_reply_button, 0) as quick_reply_button,
      coalesce(cc.tapped, 0) as tapped,
      coalesce(cc.clicked, 0) as clicked
    from post_comments pc
    left join post_cohort cc using (social_account_id, external_media_id)
  ),
  ranked as (
    select p.* from posts p
    order by p.requests_unique desc, p.comments_valid desc, p.external_media_id
    limit greatest(coalesce(p_post_limit, 50), 1)
  )
  select jsonb_build_object(
    'posts_total', (select count(*) from posts),
    'by_account', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'social_account_id', a.social_account_id,
        'comments_valid', a.comments_valid,
        'requests_unique', a.requests_unique,
        'requests_without_author', a.requests_without_author,
        'executions', a.executions,
        'first_dm', a.first_dm,
        'button', a.button,
        'link_button', a.link_button,
        'quick_reply_button', a.quick_reply_button,
        'tapped', a.tapped,
        'clicked', a.clicked
      ) order by a.requests_unique desc), '[]'::jsonb)
      from (
        select p.social_account_id,
          sum(p.comments_valid)::bigint as comments_valid,
          sum(p.requests_unique)::bigint as requests_unique,
          sum(p.requests_without_author)::bigint as requests_without_author,
          sum(p.executions)::bigint as executions,
          sum(p.first_dm)::bigint as first_dm,
          sum(p.button)::bigint as button,
          sum(p.link_button)::bigint as link_button,
          sum(p.quick_reply_button)::bigint as quick_reply_button,
          sum(p.tapped)::bigint as tapped,
          sum(p.clicked)::bigint as clicked
        from posts p
        group by p.social_account_id
      ) a
    ),
    'by_post', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'social_account_id', r.social_account_id,
        'external_media_id', r.external_media_id,
        'comments_valid', r.comments_valid,
        'requests_unique', r.requests_unique,
        'requests_without_author', r.requests_without_author,
        'executions', r.executions,
        'first_dm', r.first_dm,
        'button', r.button,
        'link_button', r.link_button,
        'quick_reply_button', r.quick_reply_button,
        'tapped', r.tapped,
        'clicked', r.clicked,
        'permalink', sp.permalink,
        'media_type', sp.media_type,
        'published_at', sp.published_at
      ) order by r.requests_unique desc, r.comments_valid desc, r.external_media_id), '[]'::jsonb)
      from ranked r
      left join lateral (
        select s.permalink, s.media_type, s.published_at
        from scheduled_posts s
        where s.workspace_id = p_workspace_id
          and s.social_account_id = r.social_account_id
          and s.external_media_id = r.external_media_id
        order by s.published_at desc nulls last
        limit 1
      ) sp on true
    )
  );
$$;

do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('metrics_request_cohort', 'metrics_funnel')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
