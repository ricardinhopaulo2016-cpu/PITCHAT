-- PITCHAT: horário real do comentário no Instagram.
--
-- O webhook de comentário não traz a hora do comentário (o `time` do envelope é
-- a hora do envio do webhook), então a hora vem da Graph API (campo timestamp)
-- e fica em source_created_at. Null = não recuperado: comentários antigos e
-- falhas da busca. Nada é inventado nem reconstruído para eles.
-- O recorte de período continua em created_at (hora de gravação, indexada);
-- só o horário usado na série diária e na latência passa a preferir o real.

alter table comments add column if not exists source_created_at timestamptz;

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
    coalesce(c.source_created_at, c.created_at) as recorded_at,
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
