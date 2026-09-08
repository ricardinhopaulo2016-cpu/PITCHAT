-- PITCHAT — migration 0002: bucket de Storage privado para a Media Library (Fase 2)
--
-- Convenção de path: todo objeto é gravado como "<workspace_id>/<media_asset_id>/<arquivo>".
-- O primeiro segmento do path é o workspace_id — as policies abaixo isolam por ele,
-- exatamente como as tabelas de domínio. Nenhum objeto é público: leitura sempre
-- via signed URL gerada pelo backend (service_role), nunca pela anon key direto.

insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

-- Extrai o workspace_id do primeiro segmento do path do objeto.
-- Retorna null (nunca dá match em is_workspace_member) se o path não for um uuid válido,
-- em vez de estourar erro.
create or replace function storage_object_workspace_id(object_name text)
returns uuid
language sql
immutable
as $$
  select case
    when (storage.foldername(object_name))[1] ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then (storage.foldername(object_name))[1]::uuid
    else null
  end;
$$;

create policy media_bucket_by_workspace on storage.objects
  for all using (
    bucket_id = 'media' and is_workspace_member(storage_object_workspace_id(name))
  )
  with check (
    bucket_id = 'media' and is_workspace_member(storage_object_workspace_id(name))
  );
