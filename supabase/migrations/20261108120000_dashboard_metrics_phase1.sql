-- PITCHAT: métricas da dashboard, Fase 1.
--
-- Só cria funções de leitura (immutable/stable). Não altera tabela, não cria
-- índice e não toca no caminho de webhook, automação ou publicação.
-- Cada RPC devolve um único jsonb: assim o max_rows = 1000 do PostgREST
-- (supabase/config.toml) não corta a série. Toda função exige p_workspace_id.
-- comments.created_at é hora de gravação e aqui só alimenta recorte de período
-- e latência interna. Nunca é tratado como hora do comentário.
-- Os índices que sustentam estas leituras estão na migration seguinte, separada
-- de propósito: estas funções funcionam sem eles, só mais devagar.

create or replace function metrics_normalize_text(p_text text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  -- Equivalente a lib/automation/normalize.ts para o português.
  select btrim(
    regexp_replace(
      regexp_replace(
        translate(lower(btrim(coalesce(p_text, ''))), 'áàãâäåéèêëíìîïóòõôöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'),
        '\s+', ' ', 'g'
      ),
      '[!?.,;:"''()\[\]{}]+', '', 'g'
    )
  );
$$;

create or replace function metrics_comment_facts(
  p_workspace_id uuid, p_phrase text, p_account_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (
  social_account_id uuid,
  external_media_id text,
  external_comment_id text,
  author_key text,
  recorded_at timestamptz,
  contact_missing boolean,
  has_payload_author boolean,
  is_valid boolean,
  is_request boolean
)
language sql
stable
set search_path = public, pg_temp
as $$
  with params as materialized (
    select metrics_normalize_text(p_phrase) as phrase
  )
  select
    c.social_account_id,
    c.external_media_id,
    c.external_comment_id,
    coalesce(d.payload_author, nullif(ct.platform_user_id, '')) as author_key,
    c.created_at as recorded_at,
    c.contact_id is null as contact_missing,
    d.payload_author is not null as has_payload_author,
    c.external_media_id is not null and d.normalized_text <> '' as is_valid,
    c.external_media_id is not null
      and p.phrase <> ''
      and position(p.phrase in d.normalized_text) > 0 as is_request
  from comments c
  cross join params p
  -- offset 0 impede o planner de repetir a expressão em cada uso.
  cross join lateral (
    select
      nullif(c.raw_payload->>'fromUserId', '') as payload_author,
      metrics_normalize_text(c.text) as normalized_text
    offset 0
  ) d
  left join contacts ct on ct.id = c.contact_id and ct.workspace_id = c.workspace_id
  where c.workspace_id = p_workspace_id
    and (p_account_id is null or c.social_account_id = p_account_id)
    and c.created_at >= p_from
    and c.created_at < p_to;
$$;

-- Uma linha por pessoa por post (conta + mídia + autor). Usa existência, nunca soma de runs.
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
  has_quick_reply_button boolean
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
    select q.social_account_id, q.external_media_id, q.author_key, q.recorded_at as comment_recorded_at, r.id as run_id, r.automation_version_id
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
  )
  select p.social_account_id, p.external_media_id, p.author_key, p.request_comments, p.first_recorded_at,
    e.author_key is not null as has_execution,
    f.first_dm_at,
    f.first_dm_comment_recorded_at,
    coalesce(b.has_link_button, false) as has_link_button,
    coalesce(b.has_quick_reply_button, false) as has_quick_reply_button
  from people p
  left join executed e using (social_account_id, external_media_id, author_key)
  left join first_send f using (social_account_id, external_media_id, author_key)
  left join buttons b using (social_account_id, external_media_id, author_key);
$$;

create or replace function metrics_events(
  p_workspace_id uuid, p_phrase text, p_account_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (kind text, occurred_at timestamptz, dedupe_key text)
language sql
stable
set search_path = public, pg_temp
as $$
  with facts as materialized (
    select f.social_account_id, f.external_media_id, f.external_comment_id, f.author_key, f.recorded_at, f.is_request
    from metrics_comment_facts(p_workspace_id, p_phrase, p_account_id, p_from, p_to) f
    where f.is_valid
  )
  select 'post_published'::text, sp.published_at, sp.id::text
  from scheduled_posts sp
  where sp.workspace_id = p_workspace_id
    and sp.status = 'published'
    and sp.published_at >= p_from and sp.published_at < p_to
    and (p_account_id is null or sp.social_account_id = p_account_id)
  union all
  select 'comment_valid', f.recorded_at, f.social_account_id::text || '|' || f.external_comment_id
  from facts f
  union all
  select 'request_unique', f.recorded_at, f.social_account_id::text || '|' || f.external_media_id || '|' || f.author_key
  from facts f
  where f.is_request and f.author_key is not null
  union all
  select 'run_started', r.started_at, r.id::text
  from automation_runs r
  left join conversations cv on cv.id = r.conversation_id and cv.workspace_id = p_workspace_id
  where r.workspace_id = p_workspace_id
    and r.started_at >= p_from and r.started_at < p_to
    and (p_account_id is null or cv.social_account_id = p_account_id)
    and not exists (
      select 1 from automation_run_steps ns
      where ns.automation_run_id = r.id and ns.status = 'succeeded' and ns.output->>'matched' = 'false'
    )
  union all
  select case when m.origin = 'manual' then 'dm_manual' else 'dm_automation' end,
    coalesce(m.sent_at, m.received_at, m.created_at),
    coalesce(m.external_message_id, m.id::text)
  from messages m
  join conversations cv on cv.id = m.conversation_id and cv.workspace_id = p_workspace_id
  where m.workspace_id = p_workspace_id
    and m.direction = 'outbound' and m.status = 'sent'
    and coalesce(m.sent_at, m.received_at, m.created_at) >= p_from and coalesce(m.sent_at, m.received_at, m.created_at) < p_to
    and (p_account_id is null or cv.social_account_id = p_account_id)
  union all
  select 'failure_run', r.updated_at, r.id::text
  from automation_runs r
  left join conversations cv on cv.id = r.conversation_id and cv.workspace_id = p_workspace_id
  where r.workspace_id = p_workspace_id
    and r.status = 'failed'
    and r.updated_at >= p_from and r.updated_at < p_to
    and (p_account_id is null or cv.social_account_id = p_account_id)
  union all
  select 'failure_message', coalesce(m.sent_at, m.received_at, m.created_at), m.id::text
  from messages m
  join conversations cv on cv.id = m.conversation_id and cv.workspace_id = p_workspace_id
  where m.workspace_id = p_workspace_id
    and m.direction = 'outbound' and m.status = 'failed'
    and coalesce(m.sent_at, m.received_at, m.created_at) >= p_from and coalesce(m.sent_at, m.received_at, m.created_at) < p_to
    and (p_account_id is null or cv.social_account_id = p_account_id);
$$;

create or replace function metrics_messages(
  p_workspace_id uuid, p_account_id uuid, p_from timestamptz, p_to timestamptz
)
returns table (
  message_key text,
  external_message_id text,
  conversation_id uuid,
  social_account_id uuid,
  direction text,
  origin text,
  message_type text,
  occurred_at timestamptz
)
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct on (m.direction, coalesce(m.external_message_id, m.id::text))
    coalesce(m.external_message_id, m.id::text),
    m.external_message_id,
    m.conversation_id,
    cv.social_account_id,
    m.direction,
    m.origin,
    m.type,
    coalesce(m.sent_at, m.received_at, m.created_at)
  from messages m
  join conversations cv on cv.id = m.conversation_id and cv.workspace_id = p_workspace_id
  where m.workspace_id = p_workspace_id
    and m.status in ('sent', 'delivered')
    and (p_account_id is null or cv.social_account_id = p_account_id)
    and coalesce(m.sent_at, m.received_at, m.created_at) >= p_from
    and coalesce(m.sent_at, m.received_at, m.created_at) < p_to
  order by m.direction, coalesce(m.external_message_id, m.id::text), coalesce(m.sent_at, m.received_at, m.created_at);
$$;

create or replace function metrics_daily(
  p_workspace_id uuid, p_phrase text, p_account_id uuid, p_from timestamptz, p_to timestamptz
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object('day', to_char(t.day, 'YYYY-MM-DD'), 'kind', t.kind, 'count', t.n) order by t.day, t.kind), '[]'::jsonb)
  from (
    select (e.occurred_at at time zone 'America/Sao_Paulo')::date as day, e.kind, count(distinct e.dedupe_key) as n
    from metrics_events(p_workspace_id, p_phrase, p_account_id, p_from, p_to) e
    group by 1, 2
  ) t;
$$;

-- Todas as janelas do comparativo numa leitura só dos fatos. Único é contado
-- dentro de cada janela, sem somar dias.
create or replace function metrics_windows_totals(
  p_workspace_id uuid, p_phrase text, p_account_id uuid, p_windows jsonb
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with windows as materialized (
    select w.value->>'key' as window_key,
      (w.value->>'from')::timestamptz as from_at,
      (w.value->>'to')::timestamptz as to_at
    from jsonb_array_elements(p_windows) w
  ),
  bounds as materialized (
    select min(from_at) as from_at, max(to_at) as to_at from windows
  ),
  events as materialized (
    select e.kind, e.occurred_at, e.dedupe_key
    from bounds b
    cross join lateral metrics_events(p_workspace_id, p_phrase, p_account_id, b.from_at, b.to_at) e
  ),
  totals as (
    select w.window_key, e.kind, count(distinct e.dedupe_key) as n
    from windows w
    join events e on e.occurred_at >= w.from_at and e.occurred_at < w.to_at
    group by w.window_key, e.kind
  ),
  by_window as (
    select t.window_key, jsonb_object_agg(t.kind, t.n) as counts
    from totals t
    group by t.window_key
  )
  select coalesce(jsonb_object_agg(w.window_key, coalesce(b.counts, '{}'::jsonb)), '{}'::jsonb)
  from windows w
  left join by_window b on b.window_key = w.window_key;
$$;

-- Primeira e última mensagem por direção, sem ler o histórico inteiro.
create or replace function metrics_message_span(
  p_workspace_id uuid, p_account_id uuid, p_direction text
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'first', (
      select coalesce(m.sent_at, m.received_at, m.created_at)
      from messages m
      join conversations cv on cv.id = m.conversation_id and cv.workspace_id = p_workspace_id
      where m.workspace_id = p_workspace_id and m.direction = p_direction
        and (p_account_id is null or cv.social_account_id = p_account_id)
      order by coalesce(m.sent_at, m.received_at, m.created_at) asc
      limit 1
    ),
    'last', (
      select coalesce(m.sent_at, m.received_at, m.created_at)
      from messages m
      join conversations cv on cv.id = m.conversation_id and cv.workspace_id = p_workspace_id
      where m.workspace_id = p_workspace_id and m.direction = p_direction
        and (p_account_id is null or cv.social_account_id = p_account_id)
      order by coalesce(m.sent_at, m.received_at, m.created_at) desc
      limit 1
    )
  );
$$;

create or replace function metrics_run_span(p_workspace_id uuid, p_account_id uuid)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'first', (
      select r.started_at
      from automation_runs r
      left join conversations cv on cv.id = r.conversation_id and cv.workspace_id = p_workspace_id
      where r.workspace_id = p_workspace_id
        and (p_account_id is null or cv.social_account_id = p_account_id)
      order by r.started_at asc
      limit 1
    ),
    'last', (
      select r.started_at
      from automation_runs r
      left join conversations cv on cv.id = r.conversation_id and cv.workspace_id = p_workspace_id
      where r.workspace_id = p_workspace_id
        and (p_account_id is null or cv.social_account_id = p_account_id)
      order by r.started_at desc
      limit 1
    )
  );
$$;

create or replace function metrics_data_confidence(
  p_workspace_id uuid, p_phrase text, p_account_id uuid, p_from timestamptz, p_to timestamptz
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with facts as (
    select * from metrics_comment_facts(p_workspace_id, p_phrase, p_account_id, p_from, p_to)
  ),
  observed as (
    select distinct f.social_account_id, f.external_media_id
    from facts f
    where f.external_media_id is not null
  ),
  period_runs as (
    select r.*, cv.social_account_id
    from automation_runs r
    left join conversations cv on cv.id = r.conversation_id and cv.workspace_id = p_workspace_id
    where r.workspace_id = p_workspace_id
      and (p_account_id is null or cv.social_account_id = p_account_id)
      and r.started_at >= p_from and r.started_at < p_to
  ),
  scoped_posts as (
    select sp.* from scheduled_posts sp
    where sp.workspace_id = p_workspace_id
      and (p_account_id is null or sp.social_account_id = p_account_id)
  )
  select jsonb_build_object(
    'sources', jsonb_build_object(
      'comments', (
        select jsonb_build_object('first', min(c.created_at), 'last', max(c.created_at))
        from comments c
        where c.workspace_id = p_workspace_id
          and (p_account_id is null or c.social_account_id = p_account_id)
      ),
      'messages_inbound', metrics_message_span(p_workspace_id, p_account_id, 'inbound'),
      'messages_outbound', metrics_message_span(p_workspace_id, p_account_id, 'outbound'),
      'runs', metrics_run_span(p_workspace_id, p_account_id),
      'posts', (select jsonb_build_object('first', min(published_at), 'last', max(published_at)) from scoped_posts where status = 'published')
    ),
    'posts_observed', (select count(*) from observed),
    'posts_unlinked', (
      select count(*) from observed o
      where not exists (
        select 1 from scheduled_posts sp
        where sp.workspace_id = p_workspace_id
          and sp.social_account_id = o.social_account_id
          and sp.external_media_id = o.external_media_id
      )
    ),
    'posts_published_without_media_id', (
      select count(*) from scoped_posts sp
      where sp.status = 'published' and sp.external_media_id is null
        and sp.published_at >= p_from and sp.published_at < p_to
    ),
    'comments_total', (select count(*) from facts),
    'comments_without_contact', (select count(*) from facts where contact_missing),
    'comments_contact_reconciled', (select count(*) from facts where contact_missing and has_payload_author),
    'comments_without_author', (select count(*) from facts where author_key is null),
    'requests_without_author', (select count(*) from facts where is_request and author_key is null),
    'requests_without_execution', (
      select count(*) from metrics_request_cohort(p_workspace_id, p_phrase, p_account_id, p_from, p_to) c
      where not c.has_execution
    ),
    'runs_total', (select count(*) from period_runs),
    'runs_without_contact', (select count(*) from period_runs where contact_id is null),
    'runs_without_conversation', (select count(*) from period_runs where conversation_id is null),
    'runs_comment_not_found', (
      select count(*) from period_runs r
      where r.trigger_source = 'comment'
        and not exists (
          select 1 from comments c
          where c.workspace_id = p_workspace_id and c.external_comment_id = r.trigger_ref_id
        )
    ),
    'runs_inactive_automation', (
      select count(*) from period_runs r
      join automations a on a.id = r.automation_id and a.workspace_id = p_workspace_id
      where a.status <> 'active'
    )
  );
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
      count(*) filter (where c.has_quick_reply_button) as quick_reply_button
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
      coalesce(cc.quick_reply_button, 0) as quick_reply_button
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
        'quick_reply_button', a.quick_reply_button
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
          sum(p.quick_reply_button)::bigint as quick_reply_button
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

create or replace function metrics_message_flow(
  p_workspace_id uuid, p_account_id uuid, p_from timestamptz, p_to timestamptz
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with msgs as (
    select * from metrics_messages(p_workspace_id, p_account_id, p_from, p_to)
  ),
  step_links as (
    select distinct on (s.output->>'externalMessageId')
      s.output->>'externalMessageId' as external_message_id,
      r.automation_id
    from automation_run_steps s
    join automation_runs r on r.id = s.automation_run_id and r.workspace_id = p_workspace_id
    where s.status = 'succeeded'
      and s.node_type in ('PRIVATE_REPLY', 'SEND_MESSAGE', 'QUICK_REPLY')
      and nullif(s.output->>'externalMessageId', '') is not null
      and s.started_at >= p_from - interval '5 minutes'
      and s.started_at < p_to + interval '5 minutes'
    order by s.output->>'externalMessageId', s.started_at
  ),
  automation_msgs as (
    select m.message_key, l.automation_id
    from msgs m
    left join step_links l on l.external_message_id = m.external_message_id
    where m.direction = 'outbound' and m.origin = 'automation'
  ),
  scoped_conversations as (
    select cv.id from conversations cv
    where cv.workspace_id = p_workspace_id
      and (p_account_id is null or cv.social_account_id = p_account_id)
  ),
  queued as (
    select m.created_at from messages m
    where m.workspace_id = p_workspace_id
      and m.status in ('queued', 'sending')
      and m.conversation_id in (select id from scoped_conversations)
  ),
  waiting_runs as (
    select r.waiting_reason, r.updated_at
    from automation_runs r
    left join conversations cv on cv.id = r.conversation_id and cv.workspace_id = p_workspace_id
    where r.workspace_id = p_workspace_id
      and r.status = 'waiting'
      and (p_account_id is null or cv.social_account_id = p_account_id)
  )
  select jsonb_build_object(
    'by_day', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.day), '[]'::jsonb) from (
        select to_char(m.occurred_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD') as day,
          count(*) filter (where m.direction = 'inbound') as inbound,
          count(*) filter (where m.direction = 'inbound' and m.message_type = 'quick_reply') as inbound_clicks,
          count(*) filter (where m.direction = 'outbound' and m.origin = 'automation') as outbound_automation,
          count(*) filter (where m.direction = 'outbound' and m.origin = 'manual') as outbound_manual
        from msgs m group by 1
      ) d
    ),
    'by_hour', (
      select coalesce(jsonb_agg(to_jsonb(h) order by h.hour), '[]'::jsonb) from (
        select to_char(m.occurred_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD"T"HH24') as hour,
          count(*) filter (where m.direction = 'inbound') as inbound,
          count(*) filter (where m.direction = 'inbound' and m.message_type = 'quick_reply') as inbound_clicks,
          count(*) filter (where m.direction = 'outbound' and m.origin = 'automation') as outbound_automation,
          count(*) filter (where m.direction = 'outbound' and m.origin = 'manual') as outbound_manual
        from msgs m group by 1
      ) h
    ),
    'by_account', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.social_account_id), '[]'::jsonb) from (
        select m.social_account_id,
          count(*) filter (where m.direction = 'inbound') as inbound,
          count(*) filter (where m.direction = 'inbound' and m.message_type = 'quick_reply') as inbound_clicks,
          count(*) filter (where m.direction = 'outbound' and m.origin = 'automation') as outbound_automation,
          count(*) filter (where m.direction = 'outbound' and m.origin = 'manual') as outbound_manual
        from msgs m group by m.social_account_id
      ) a
    ),
    'by_automation', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.outbound desc), '[]'::jsonb) from (
        select a.id as automation_id, a.name, a.status, count(*) as outbound
        from automation_msgs am
        join automations a on a.id = am.automation_id and a.workspace_id = p_workspace_id
        group by a.id, a.name, a.status
      ) x
    ),
    'outbound_automation_unlinked', (select count(*) from automation_msgs where automation_id is null),
    'queue', jsonb_build_object(
      'queued_count', (select count(*) from queued),
      'queued_oldest_at', (select min(created_at) from queued),
      'waiting_delay', (select count(*) from waiting_runs where waiting_reason = 'delay'),
      'waiting_retry', (select count(*) from waiting_runs where waiting_reason = 'retry'),
      'waiting_oldest_at', (select min(updated_at) from waiting_runs where waiting_reason in ('delay', 'retry')),
      'waiting_quick_reply', (select count(*) from waiting_runs where waiting_reason = 'quick_reply')
    )
  );
$$;

create or replace function metrics_response_times(
  p_workspace_id uuid, p_phrase text, p_account_id uuid, p_from timestamptz, p_to timestamptz
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with internal as (
    select c.social_account_id, extract(epoch from (c.first_dm_at - c.first_dm_comment_recorded_at))::double precision as seconds
    from metrics_request_cohort(p_workspace_id, p_phrase, p_account_id, p_from, p_to) c
    where c.first_dm_at is not null and c.first_dm_at >= c.first_dm_comment_recorded_at
  ),
  first_inbound as (
    select m.conversation_id, min(m.occurred_at) as first_at
    from metrics_messages(p_workspace_id, p_account_id, p_from, p_to) m
    where m.direction = 'inbound' and m.message_type <> 'quick_reply'
    group by m.conversation_id
  ),
  manual_replies as (
    select o.conversation_id, o.occurred_at
    from metrics_messages(p_workspace_id, p_account_id, p_from, 'infinity'::timestamptz) o
    where o.direction = 'outbound' and o.origin = 'manual'
  ),
  human as (
    select i.conversation_id, i.first_at, min(o.occurred_at) as answered_at
    from first_inbound i
    left join manual_replies o on o.conversation_id = i.conversation_id and o.occurred_at > i.first_at
    group by i.conversation_id, i.first_at
  )
  select jsonb_build_object(
    'internal', (
      select jsonb_build_object(
        'samples', count(*),
        'p50_seconds', percentile_cont(0.5) within group (order by seconds),
        'p95_seconds', percentile_cont(0.95) within group (order by seconds)
      ) from internal
    ),
    'internal_by_account', (
      select coalesce(jsonb_agg(to_jsonb(a) order by a.social_account_id), '[]'::jsonb) from (
        select i.social_account_id, count(*) as samples,
          percentile_cont(0.5) within group (order by i.seconds) as p50_seconds,
          percentile_cont(0.95) within group (order by i.seconds) as p95_seconds
        from internal i group by i.social_account_id
      ) a
    ),
    'human', (
      select jsonb_build_object(
        'conversations_with_inbound', count(*),
        'answered', count(answered_at),
        'p50_seconds', percentile_cont(0.5) within group (order by extract(epoch from (answered_at - first_at))::double precision),
        'p95_seconds', percentile_cont(0.95) within group (order by extract(epoch from (answered_at - first_at))::double precision)
      ) from human
    )
  );
$$;

create or replace function metrics_failures(
  p_workspace_id uuid, p_account_id uuid, p_from timestamptz, p_to timestamptz, p_stuck_before timestamptz, p_incident_limit integer default 50
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with run_rows as not materialized (
    select r.id, r.automation_id, r.status, r.started_at, r.updated_at, cv.social_account_id, a.name as automation_name, a.status as automation_status
    from automation_runs r
    join automations a on a.id = r.automation_id and a.workspace_id = p_workspace_id
    left join conversations cv on cv.id = r.conversation_id and cv.workspace_id = p_workspace_id
    where r.workspace_id = p_workspace_id
      and (p_account_id is null or cv.social_account_id = p_account_id)
  ),
  period_runs as (
    select * from run_rows where updated_at >= p_from and updated_at < p_to
  ),
  failed as (
    select * from period_runs where status = 'failed'
  ),
  -- Retrato atual, como a fila: uma run presa não some quando o último update sai do período.
  stuck as (
    select * from run_rows where status = 'running' and started_at < p_stuck_before
  ),
  incident_runs as (
    select * from failed union all select * from stuck
  ),
  last_step as (
    select distinct on (s.automation_run_id)
      s.automation_run_id, s.node_id, s.node_type, s.status, s.error->>'message' as cause
    from automation_run_steps s
    where s.automation_run_id in (select id from incident_runs)
    order by s.automation_run_id, s.started_at desc, s.attempt desc, s.id
  ),
  failed_steps as (
    select f.automation_id, f.automation_name, l.node_id, l.node_type, l.cause
    from failed f join last_step l on l.automation_run_id = f.id
    where l.status = 'failed'
  ),
  node_totals as (
    select f.automation_id, f.automation_name, f.node_id, f.node_type, count(*) as failures
    from failed_steps f
    group by f.automation_id, f.automation_name, f.node_id, f.node_type
  ),
  node_reached as (
    select n.automation_id, n.node_id, count(distinct s.automation_run_id) as reached
    from node_totals n
    join period_runs r on r.automation_id = n.automation_id
    join automation_run_steps s on s.automation_run_id = r.id and s.node_id = n.node_id
    group by n.automation_id, n.node_id
  )
  select jsonb_build_object(
    'runs_in_period', (select count(*) from period_runs),
    'failed_runs', (select count(*) from failed),
    'failed_without_step', (select count(*) from failed f where not exists (select 1 from last_step l where l.automation_run_id = f.id and l.status = 'failed')),
    'stuck_runs', (select count(*) from stuck),
    'retry_attempts', (
      select count(*) from automation_run_steps s
      join period_runs r on r.id = s.automation_run_id
      where s.status = 'failed' and r.status <> 'failed'
    ),
    'by_node', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'automation_id', n.automation_id,
        'automation_name', n.automation_name,
        'node_id', n.node_id,
        'node_type', n.node_type,
        'failures', n.failures,
        'reached', coalesce(nr.reached, 0)
      ) order by n.failures desc, n.node_id), '[]'::jsonb)
      from node_totals n
      left join node_reached nr on nr.automation_id = n.automation_id and nr.node_id = n.node_id
    ),
    'errors', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.failures desc), '[]'::jsonb) from (
        select left(f.cause, 500) as cause, count(*) as failures
        from failed_steps f
        where f.cause is not null
        group by left(f.cause, 500)
        order by count(*) desc
        limit 30
      ) e
    ),
    'incidents', (
      select coalesce(jsonb_agg(to_jsonb(i) order by i.updated_at desc), '[]'::jsonb) from (
        select r.id as run_id, r.status, r.started_at, r.updated_at, r.automation_id, r.automation_name, r.automation_status, r.social_account_id,
          l.node_id, l.node_type, l.status as step_status, l.cause
        from incident_runs r
        left join last_step l on l.automation_run_id = r.id
        order by r.updated_at desc
        limit greatest(coalesce(p_incident_limit, 50), 1)
      ) i
    )
  );
$$;

create or replace function metrics_run_incident(
  p_workspace_id uuid, p_account_id uuid, p_run_prefix text
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'run_id', r.id,
    'status', r.status,
    'waiting_reason', r.waiting_reason,
    'trigger_source', r.trigger_source,
    'started_at', r.started_at,
    'updated_at', r.updated_at,
    'automation_id', a.id,
    'automation_name', a.name,
    'automation_status', a.status,
    'social_account_id', cv.social_account_id,
    'steps', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'node_id', s.node_id,
        'node_type', s.node_type,
        'status', s.status,
        'attempt', s.attempt,
        'started_at', s.started_at,
        'cause', s.error->>'message'
      ) order by s.started_at, s.attempt, s.id), '[]'::jsonb)
      from automation_run_steps s
      where s.automation_run_id = r.id
    )
  ) order by r.started_at desc), '[]'::jsonb)
  from (
    select * from automation_runs x
    where x.workspace_id = p_workspace_id
      and p_run_prefix ~ '^[0-9a-f]{8}$'
      and x.id::text like p_run_prefix || '%'
    order by x.started_at desc
    limit 3
  ) r
  join automations a on a.id = r.automation_id and a.workspace_id = p_workspace_id
  left join conversations cv on cv.id = r.conversation_id and cv.workspace_id = p_workspace_id
  where p_account_id is null or cv.social_account_id = p_account_id;
$$;

create or replace function metrics_viral_base(
  p_workspace_id uuid, p_phrase text, p_account_id uuid, p_mature_before timestamptz, p_top_limit integer default 5
)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with accounts as (
    select sa.id, sa.username from social_accounts sa
    where sa.workspace_id = p_workspace_id
      and sa.platform = 'instagram'
      and sa.status <> 'revoked'
      and (p_account_id is null or sa.id = p_account_id)
  ),
  requests as (
    select f.social_account_id, f.external_media_id, f.author_key
    from metrics_comment_facts(p_workspace_id, p_phrase, p_account_id, '-infinity'::timestamptz, 'infinity'::timestamptz) f
    where f.is_request and f.author_key is not null
  ),
  top_posts as (
    select c.social_account_id, c.external_media_id, count(distinct c.author_key) as requests_unique
    from requests c
    group by c.social_account_id, c.external_media_id
    order by count(distinct c.author_key) desc, c.external_media_id
    limit greatest(coalesce(p_top_limit, 5), 1)
  )
  select jsonb_build_object(
    'accounts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'social_account_id', a.id,
        'username', a.username,
        'mature_reels', (
          select count(distinct sp.external_media_id) from scheduled_posts sp
          where sp.workspace_id = p_workspace_id and sp.social_account_id = a.id
            and sp.status = 'published' and sp.media_type = 'REELS'
            and sp.external_media_id is not null
            and sp.published_at is not null and sp.published_at <= p_mature_before
        )
      ) order by a.username), '[]'::jsonb)
      from accounts a
    ),
    'top_posts', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'social_account_id', t.social_account_id,
        'external_media_id', t.external_media_id,
        'requests_unique', t.requests_unique,
        'permalink', sp.permalink
      ) order by t.requests_unique desc, t.external_media_id), '[]'::jsonb)
      from top_posts t
      left join lateral (
        select s.permalink from scheduled_posts s
        where s.workspace_id = p_workspace_id
          and s.social_account_id = t.social_account_id
          and s.external_media_id = t.external_media_id
        order by s.published_at desc nulls last
        limit 1
      ) sp on true
    )
  );
$$;

-- Só o service_role (rotas server-side) executa. O PostgREST expõe o schema
-- public e cada RPC abaixo recebe workspace_id como parâmetro.
do $$
declare
  fn regprocedure;
begin
  for fn in
    select p.oid::regprocedure
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'metrics\_%'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end;
$$;
