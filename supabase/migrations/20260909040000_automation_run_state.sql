-- PITCHAT — migration 0004: estado completo de automation_runs (Fase D)
--
-- O motor de automação precisa saber, além do que já existia (status,
-- cursor_node_id), POR QUE um run está esperando (waiting_reason) e um
-- contexto livre pra guardar variáveis do flow entre steps (context).

alter table automation_runs
  drop constraint if exists automation_runs_status_check,
  add column if not exists waiting_reason text,
  add column if not exists context jsonb not null default '{}'::jsonb,
  add column if not exists updated_at timestamptz not null default now();

alter table automation_runs
  add constraint automation_runs_status_check
  check (status in ('running', 'waiting', 'completed', 'failed', 'cancelled'));

comment on column automation_runs.waiting_reason is
  'Por que o run está pausado: ex. "user_reply", "quick_reply", "delay". Null quando status != waiting.';
comment on column automation_runs.context is
  'Variáveis livres do flow (ex.: link gerado, texto que o usuário mandou) — o que os nodes leem/escrevem entre steps.';

create index if not exists idx_automation_runs_status on automation_runs(status);
create index if not exists idx_automation_runs_waiting on automation_runs(status, waiting_reason) where status = 'waiting';
