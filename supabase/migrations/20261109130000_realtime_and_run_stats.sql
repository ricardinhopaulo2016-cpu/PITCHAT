-- Tempo real da dash e contagem de execuções em uma consulta só.
--
-- Publica só as tabelas que as telas usam como sinal de "algo mudou". Ficam de
-- fora de propósito:
--   social_accounts: a linha carrega o token criptografado, e o evento leva a linha inteira.
--   webhook_events e jobs: RLS nega o cliente, então o evento nunca chegaria.
--   automation_run_steps: volume alto e sem workspace_id para filtrar o canal.
-- Saúde e Contas dependem delas e por isso também atualizam por intervalo.
--
-- Todas as tabelas abaixo têm policy por workspace (20260908181550_init.sql e
-- 20261102120000_scheduled_posts.sql), que o Realtime aplica em cada evento.

do $$
declare
  table_name text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;

  foreach table_name in array array[
    'conversations',
    'messages',
    'comments',
    'contacts',
    'automations',
    'automation_runs',
    'scheduled_posts',
    'media_assets'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;

-- Tela Automações: troca duas contagens por automação por uma consulta agrupada.
create or replace function public.automation_run_stats(
  p_workspace_id uuid,
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns table (automation_id uuid, total bigint, errors bigint)
language sql
stable
set search_path = public, pg_temp
as $$
  select
    r.automation_id,
    count(*) as total,
    count(*) filter (where r.status = 'failed') as errors
  from automation_runs r
  where r.workspace_id = p_workspace_id
    and (p_start is null or r.started_at >= p_start)
    and (p_end is null or r.started_at < p_end)
  group by r.automation_id;
$$;

revoke all on function public.automation_run_stats(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.automation_run_stats(uuid, timestamptz, timestamptz) to service_role;
