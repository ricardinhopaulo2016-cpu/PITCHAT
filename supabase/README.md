# Supabase — PITCHAT

Projeto **exclusivo** do PITCHAT. Não reutilizar o projeto Supabase do PitBrain — nenhuma tabela,
secret, Auth ou Storage é compartilhado entre os dois produtos.

**Fonte de verdade do schema: `supabase/migrations/*.sql`** (aplicadas via Supabase CLI).
`schema.sql` é só um snapshot de leitura — nunca editar à mão, regenerar com
`supabase db dump --linked -f supabase/schema.sql` depois de cada migration nova.

## Setup (primeira vez)

1. Crie um projeto novo em [supabase.com](https://supabase.com) (nome sugerido: `pitchat`).
2. Nas API settings do projeto, use o **novo modelo de keys** do Supabase (não o legado
   anon/service_role): copie a **Publishable key** (`sb_publishable_...`) e a **Secret key**
   (`sb_secret_...`). Preencha `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_URL` → a Project URL (mesmo valor nas duas)
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → a Publishable key
   - `SUPABASE_SECRET_KEY` → a Secret key (nunca em `.env.example`, docs, migration ou Git)
3. Autentique o CLI: `npx supabase login` (abre o navegador, você aprova — não dá pra automatizar isso).
4. Link o projeto local ao remoto: `npx supabase link --project-ref <PROJECT_REF>`
   — o Project Ref está na URL do dashboard (`supabase.com/dashboard/project/<ref>`) ou em
   Settings → General → Reference ID. O comando vai pedir a senha do Postgres do projeto
   (definida na criação, resetável em Settings → Database → Reset database password).
5. Aplique as migrations: `npx supabase db push --linked`.
6. Crie seu usuário em **Authentication → Users → Add user** (defina senha lá).
7. Adicione seu e-mail em `PITCHAT_ALLOWED_EMAILS` no `.env.local`.
8. Crie manualmente seu workspace inicial e sua membership (ainda não existe UI pra isso na Fase 1):

   ```sql
   insert into workspaces (name, slug) values ('Minha Empresa', 'minha-empresa') returning id;
   -- copie o id retornado e o seu auth.users.id (Authentication → Users → clique no usuário)
   insert into workspace_members (workspace_id, user_id, role) values ('<workspace_id>', '<seu_user_id>', 'owner');
   ```

9. `npm run dev`, acesse `/login`.

## Workflow de migrations (a partir de agora)

```bash
# criar uma migration nova (gera supabase/migrations/<timestamp>_<nome>.sql vazio)
npx supabase migration new nome_da_mudanca

# editar o arquivo gerado, depois aplicar no projeto linkado
npx supabase db push --linked

# conferir o que já foi aplicado vs. o que falta
npx supabase migration list --linked

# regenerar o snapshot de leitura depois de aplicar
npx supabase db dump --linked -f supabase/schema.sql
```

Nunca editar `schema.sql` diretamente esperando que isso mude o banco — ele não é lido por
nenhum comando de deploy, é só documentação. Nunca alterar uma tabela em produção fora de uma
migration versionada.

## Migrations existentes

- `0001_init` — schema completo da Fase 1 (workspaces, profiles, social_accounts, contacts/
  conversations/messages/comments, automations versionadas + runs/steps, tags, custom fields,
  webhook_events, jobs, media library, links, audit_logs) com RLS por workspace em tudo.
- `0002_media_storage_bucket` — bucket privado `media` (Storage) para a Fase 2, com policy de
  isolamento por workspace baseada no primeiro segmento do path do objeto.
