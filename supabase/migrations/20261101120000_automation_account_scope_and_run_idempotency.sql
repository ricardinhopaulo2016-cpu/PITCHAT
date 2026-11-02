-- PITCHAT: automação por conta e idempotência de run por comentário.
--
-- social_account_id NULL mantém o comportamento antigo (vale para todas as
-- contas do profile). Preenchido, a automação só roda naquela conta.
-- on delete cascade de propósito: com set null, apagar a conta transformaria
-- uma automação de uma conta só em automação do profile inteiro.
alter table automations
  add column if not exists social_account_id uuid references social_accounts(id) on delete cascade;

create index if not exists idx_automations_social_account on automations(social_account_id);

comment on column automations.social_account_id is
  'Conta onde a automação roda. NULL = todas as contas do profile.';

-- Retry do QStash ou dois workers no mesmo comentário nunca criam duas runs
-- da mesma automação. trigger_ref_id NULL não colide (NULLs são distintos).
create unique index if not exists uq_automation_runs_trigger
  on automation_runs(automation_id, trigger_source, trigger_ref_id);
