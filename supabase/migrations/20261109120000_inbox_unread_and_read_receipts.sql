-- PITCHAT: caixa de entrada com "não lidas" reais e confirmação de visualização.
--
-- Antes daqui, "não lida" era last_message_at > last_read_at, e last_message_at
-- também é tocado por mensagem ENVIADA pela automação: conversa aparecia como
-- não lida sem a pessoa ter mandado nada. Agora só o que a PESSOA manda conta.
--
-- Pode rodar mais de uma vez sem efeito colateral. O backfill só toca conversa
-- que ainda está com last_inbound_at nulo.
-- Esta migration faz UPDATE em todas as conversas com histórico dentro de uma
-- transação: durante esse tempo o webhook espera para escrever nelas.

alter table conversations
  add column if not exists last_inbound_at timestamptz,
  add column if not exists unread_inbound_count integer not null default 0;

alter table messages
  add column if not exists read_at timestamptz;

-- Backfill. last_inbound_at considera DMs recebidas E comentários; o contador
-- considera SÓ DMs depois de last_read_at, para não inundar a caixa com
-- comentários de semanas atrás. Duplicata antiga do mesmo mid conta uma vez.
with inbound_dm as (
  select m.conversation_id, max(coalesce(m.received_at, m.created_at)) as occurred_at
  from messages m
  where m.direction = 'inbound'
  group by m.conversation_id
),
comment_activity as (
  select cm.social_account_id, cm.contact_id, max(cm.created_at) as occurred_at
  from comments cm
  where cm.contact_id is not null
  group by cm.social_account_id, cm.contact_id
),
unread_dm as (
  select m.conversation_id, count(distinct coalesce(m.external_message_id, m.id::text))::integer as n
  from messages m
  join conversations c on c.id = m.conversation_id and c.workspace_id = m.workspace_id
  where m.direction = 'inbound'
    and (c.last_read_at is null or coalesce(m.received_at, m.created_at) > c.last_read_at)
  group by m.conversation_id
),
computed as (
  select c.id, greatest(d.occurred_at, ca.occurred_at) as inbound_at, coalesce(u.n, 0) as unread
  from conversations c
  left join inbound_dm d on d.conversation_id = c.id
  left join comment_activity ca on ca.social_account_id = c.social_account_id and ca.contact_id = c.contact_id
  left join unread_dm u on u.conversation_id = c.id
  where c.last_inbound_at is null
)
update conversations c
set last_inbound_at = b.inbound_at,
    unread_inbound_count = b.unread
from computed b
where c.id = b.id
  and b.inbound_at is not null;

-- Registra uma entrada da pessoa: atômico, sem ler e regravar no código.
-- greatest() ignora null e impede que um evento atrasado recue os horários.
create or replace function register_conversation_inbound(
  p_workspace_id uuid, p_conversation_id uuid, p_at timestamptz default now()
)
returns integer
language sql
set search_path = public, pg_temp
as $$
  update conversations
  set unread_inbound_count = unread_inbound_count + 1,
      last_inbound_at = greatest(last_inbound_at, coalesce(p_at, now())),
      last_message_at = greatest(last_message_at, coalesce(p_at, now())),
      updated_at = greatest(updated_at, coalesce(p_at, now()))
  where id = p_conversation_id
    and workspace_id = p_workspace_id
  returning unread_inbound_count;
$$;

-- Mesmo padrão das RPCs de métricas: só o service_role (rotas server-side) executa.
revoke all on function register_conversation_inbound(uuid, uuid, timestamptz) from public, anon, authenticated;
grant execute on function register_conversation_inbound(uuid, uuid, timestamptz) to service_role;

-- Sustentam a lista (com e sem filtro de conta) e o total de não lidas.
create index if not exists idx_conversations_inbox_order
  on conversations (workspace_id, last_inbound_at desc nulls last, last_message_at desc nulls last, id);
create index if not exists idx_conversations_inbox_channel_order
  on conversations (workspace_id, social_account_id, last_inbound_at desc nulls last, last_message_at desc nulls last, id);
create index if not exists idx_conversations_inbox_unread
  on conversations (workspace_id, social_account_id)
  where unread_inbound_count > 0;

-- Prévias da lista (a cada atualização automática) e timeline da conversa. Sem
-- o primeiro, a prévia percorre todos os comentários da conta.
create index if not exists idx_comments_account_contact_created
  on comments (social_account_id, contact_id, created_at desc);
create index if not exists idx_messages_conversation_created
  on messages (conversation_id, created_at desc);

-- Uma DM recebida só existe uma vez por conversa, mesmo com dois webhooks
-- simultâneos. O histórico pode já ter duplicatas (a tabela nunca teve essa
-- trava) e esta migration não apaga nada: o índice vale só para linhas criadas
-- daqui em diante, com o corte gravado na hora de criar. Reenvio de uma DM
-- anterior ao corte é barrado pela checagem em lib/automation/messages.ts.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'uq_messages_inbound_external_id'
  ) then
    execute format(
      'create unique index uq_messages_inbound_external_id on messages (conversation_id, external_message_id) '
      'where direction = ''inbound'' and external_message_id is not null and created_at >= %L::timestamptz',
      now()
    );
  end if;
end;
$$;
