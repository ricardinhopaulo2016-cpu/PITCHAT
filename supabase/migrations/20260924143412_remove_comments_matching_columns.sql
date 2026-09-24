-- Remove comments.matched_automation_id e comments.automation_processed_at
-- (auditoria de 24/09/2026): as duas eram escritas por nenhum código,
-- lidas por nenhum código, e a semântica delas era inviável desde o início
-- — um único comentário pode disparar VÁRIAS automation_runs (uma por
-- automação ativa do perfil, ver lib/automation/ingest.ts::ingestInstagramComment),
-- então "a automação que casou" (singular) nunca conseguiu representar o
-- caso real. A relação correta já existe e já funciona sem essas colunas:
-- automation_runs.trigger_source='comment' + trigger_ref_id=<external_comment_id>
-- é o 1:N de verdade, populado desde o início.
--
-- Confirmado antes desta migration (sessão de 24/09/2026): nenhum código
-- (app/, lib/, __tests__/) lê ou escreve essas colunas; nenhuma FK, index,
-- constraint, policy ou view do schema depende delas — são colunas soltas,
-- sem nenhuma dependência associada pra remover junto.
alter table comments
  drop column if exists matched_automation_id,
  drop column if exists automation_processed_at;
