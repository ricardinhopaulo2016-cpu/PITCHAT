# Supabase — PITCHAT

Projeto **exclusivo** do PITCHAT. Não reutilizar o projeto Supabase do PitBrain — nenhuma tabela,
secret, Auth ou Storage é compartilhado entre os dois produtos.

## Setup

1. Crie um projeto novo em [supabase.com](https://supabase.com) (nome sugerido: `pitchat`).
2. Copie **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`.
3. Copie a **anon key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Copie a **service_role key** (secreta) → `SUPABASE_SERVICE_ROLE_KEY`.
5. Rode `schema.sql` inteiro no **SQL Editor** do projeto.
6. Crie seu usuário em **Authentication → Users → Add user** (defina senha lá).
7. Adicione seu e-mail em `PITCHAT_ALLOWED_EMAILS` no `.env.local`.
8. Crie manualmente seu workspace inicial e sua membership (ainda não existe UI pra isso na Fase 1):

   ```sql
   insert into workspaces (name, slug) values ('Minha Empresa', 'minha-empresa') returning id;
   -- copie o id retornado e o seu auth.users.id (Authentication → Users → clique no usuário)
   insert into workspace_members (workspace_id, user_id, role) values ('<workspace_id>', '<seu_user_id>', 'owner');
   ```

9. `npm run dev`, acesse `/login`.

## Migrations

Enquanto o projeto é pequeno, `schema.sql` é a fonte de verdade (idempotente via `create table if not exists`).
A partir da Fase 2, mudanças de schema passam a ser arquivos numerados em `supabase/migrations/`
(`0001_...sql`, `0002_...sql`) em vez de editar `schema.sql` direto — nunca alterar schema em produção
sem migration versionada (ver docs/PITCHAT_ARCHITECTURE.md §10).
