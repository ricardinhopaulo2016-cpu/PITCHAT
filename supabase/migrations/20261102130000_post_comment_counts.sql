-- PITCHAT: comentários por post, para a meta de EU QUERO da Visão geral.
--
-- Agrega no banco porque um post pode passar de 1.000 comentários e a API do
-- Supabase corta a resposta em 1.000 linhas. Só leitura, não altera tabela.
create or replace function post_comment_counts(p_workspace_id uuid, p_phrase text, p_limit integer default 8)
returns table (
  external_media_id text,
  social_account_id uuid,
  matched bigint,
  total bigint,
  last_comment_at timestamptz
)
language sql
stable
as $$
  select
    c.external_media_id,
    c.social_account_id,
    count(*) filter (where lower(coalesce(c.text, '')) like '%' || lower(p_phrase) || '%') as matched,
    count(*) as total,
    max(c.created_at) as last_comment_at
  from comments c
  where c.workspace_id = p_workspace_id
    and c.external_media_id is not null
  group by c.external_media_id, c.social_account_id
  order by matched desc, total desc
  limit p_limit;
$$;
