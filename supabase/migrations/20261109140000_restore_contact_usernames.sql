-- Devolve o @ dos contatos que perderam o nome.
--
-- Até o commit 29e2b1d, cada DM recebida gravava username null no contato, porque
-- o evento de DM não traz o @. O comentário original guardou o @ em raw_payload.
-- Só preenche quem está sem @: nunca sobrescreve um valor existente.

update contacts c
set username = latest.username
from (
  select distinct on (contact_id)
    contact_id,
    workspace_id,
    raw_payload->>'fromUsername' as username
  from comments
  where contact_id is not null
    and nullif(raw_payload->>'fromUsername', '') is not null
  order by contact_id, created_at desc
) latest
where c.id = latest.contact_id
  and c.workspace_id = latest.workspace_id
  and c.username is null;
