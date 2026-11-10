-- PITCHAT: API de ingestão (subir e agendar Reels sem o navegador).
--
-- api_tokens: só o hash SHA-256 do token fica no banco. O token em texto
-- aparece uma vez, na hora de gerar. Revogar = preencher revoked_at.
create table if not exists api_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  name text not null,
  token_hash text not null unique,
  -- Primeiros caracteres, só para reconhecer o token na lista.
  token_prefix text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_api_tokens_workspace on api_tokens(workspace_id, created_at desc);

alter table api_tokens enable row level security;

drop policy if exists api_tokens_by_workspace on api_tokens;
create policy api_tokens_by_workspace on api_tokens
  for all using (is_workspace_member(workspace_id))
  with check (is_workspace_member(workspace_id));

-- client_ref: código do post dado por quem agenda (ex.: R2-PIT-R685-HA-261112-0800).
-- Mandar o mesmo código de novo não cria outro post: devolve o que já existe.
alter table scheduled_posts add column if not exists client_ref text;

create unique index if not exists idx_scheduled_posts_client_ref
  on scheduled_posts(workspace_id, client_ref)
  where client_ref is not null;
