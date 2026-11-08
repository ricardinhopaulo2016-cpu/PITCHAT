-- PITCHAT: índices das métricas da dashboard, Fase 1.
--
-- Sustentam as RPCs de 20261108120000_dashboard_metrics_phase1.sql, que filtram
-- por workspace e período em tabelas quentes do webhook e da automação.
--
-- ANTES de aplicar esta migration em produção, rode cada comando abaixo, um por
-- vez e fora de transação (SQL Editor do Supabase, um comando por execução).
-- CONCURRENTLY não bloqueia a escrita do webhook enquanto o índice é criado:
--
--   create index concurrently if not exists idx_comments_workspace_created on comments (workspace_id, created_at);
--   create index concurrently if not exists idx_comments_workspace_external on comments (workspace_id, external_comment_id);
--   create index concurrently if not exists idx_messages_workspace_occurred on messages (workspace_id, (coalesce(sent_at, received_at, created_at)));
--   create index concurrently if not exists idx_messages_workspace_in_queue on messages (workspace_id, created_at) where status in ('queued', 'sending');
--   create index concurrently if not exists idx_automation_runs_workspace_started on automation_runs (workspace_id, started_at);
--   create index concurrently if not exists idx_automation_runs_workspace_updated on automation_runs (workspace_id, updated_at);
--   create index concurrently if not exists idx_automation_runs_workspace_comment_ref on automation_runs (workspace_id, trigger_ref_id) where trigger_source = 'comment';
--   create index concurrently if not exists idx_automation_run_steps_started on automation_run_steps (started_at);
--
-- Depois confira que nenhum ficou inválido (criação interrompida):
--   select indexrelid::regclass from pg_index where not indisvalid;
-- Índice inválido: apague com drop index concurrently e crie de novo.
--
-- Os comandos abaixo viram no-op quando os índices acima já existem. Se esta
-- migration rodar sem o passo anterior, ela ainda funciona, mas cada índice
-- bloqueia a escrita na tabela durante a criação.

create index if not exists idx_comments_workspace_created on comments (workspace_id, created_at);
create index if not exists idx_comments_workspace_external on comments (workspace_id, external_comment_id);
create index if not exists idx_messages_workspace_occurred on messages (workspace_id, (coalesce(sent_at, received_at, created_at)));
create index if not exists idx_messages_workspace_in_queue on messages (workspace_id, created_at) where status in ('queued', 'sending');
create index if not exists idx_automation_runs_workspace_started on automation_runs (workspace_id, started_at);
create index if not exists idx_automation_runs_workspace_updated on automation_runs (workspace_id, updated_at);
create index if not exists idx_automation_runs_workspace_comment_ref on automation_runs (workspace_id, trigger_ref_id) where trigger_source = 'comment';
create index if not exists idx_automation_run_steps_started on automation_run_steps (started_at);
