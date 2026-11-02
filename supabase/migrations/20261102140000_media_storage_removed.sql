-- PITCHAT: o arquivo de uma mídia é apagado do Storage depois que todos os posts
-- dela saíram, para a biblioteca não crescer sem limite. O registro da mídia (SHA-256,
-- metadados) e o dos posts continuam, então o histórico e a trava "mesmo vídeo como
-- Reel duas vezes na mesma conta" seguem valendo.
--
-- null = o arquivo está no Storage. Preenchido = foi apagado nesse momento.
-- Reenviar o mesmo vídeo devolve o arquivo à mesma mídia e limpa esta coluna.
alter table media_assets
  add column if not exists storage_removed_at timestamptz;

comment on column media_assets.storage_removed_at is
  'Quando o arquivo foi apagado do Storage após a publicação. null = arquivo presente.';
