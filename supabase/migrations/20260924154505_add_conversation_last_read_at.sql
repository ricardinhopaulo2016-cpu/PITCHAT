-- Suporte real a "unread" no Inbox (auditoria de 24/09/2026): sem uma coluna
-- de verdade marcando quando a pessoa do workspace viu a conversa pela
-- última vez, não daria pra mostrar "não lida" sem inventar o dado. Unread =
-- last_message_at > last_read_at (ou last_read_at nulo e já tem mensagem).
alter table conversations
  add column if not exists last_read_at timestamptz;
