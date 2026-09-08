-- PITCHAT — migration 0003: estado de processamento da Media Library (Fase 2)
--
-- O pipeline de ingest é assíncrono em 2 passos (upload direto pro Storage via
-- signed URL, depois "finalize" no servidor) — precisamos rastrear em que
-- estado cada asset está, e por que falhou quando falha.

alter table media_assets
  add column if not exists status text not null default 'pending'
    check (status in ('pending', 'processing', 'ready', 'duplicate', 'failed')),
  add column if not exists processing_error jsonb,
  add column if not exists uploaded_by uuid references auth.users(id);

comment on column media_assets.status is
  'pending: signed upload URL emitida, arquivo ainda não chegou no Storage nem foi finalizado.
   processing: finalize em andamento (baixando do Storage, rodando ffprobe/hash).
   ready: pipeline completo, metadata populada.
   duplicate: finalize detectou EXACT_DUPLICATE (mesmo sha256) — esta linha é o registro
     provisório, o objeto de Storage correspondente já foi removido, mantida só para
     log/observabilidade e não deve aparecer na listagem da Media Library.
   failed: pipeline explodiu (mime inválido, ffprobe falhou, etc) — processing_error explica.';

-- sha256 fica NOT NULL só depois que o finalize roda; antes disso é um placeholder
-- vazio, então a constraint unique(workspace_id, sha256) não pode barrar múltiplos
-- "pending" simultâneos. Trocamos por um índice único parcial (só linhas 'ready').
alter table media_assets alter column sha256 drop not null;
alter table media_assets drop constraint if exists media_assets_workspace_id_sha256_key;

create unique index if not exists media_assets_workspace_sha256_ready_uidx
  on media_assets (workspace_id, sha256)
  where status = 'ready';

create index if not exists idx_media_assets_status on media_assets(status);
