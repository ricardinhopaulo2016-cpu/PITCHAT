# Supabase — PITCHAT

Projeto **exclusivo** do PITCHAT. Não reutilizar o projeto Supabase do PitBrain — nenhuma tabela,
secret, Auth ou Storage é compartilhado entre os dois produtos.

**Fonte de verdade do schema: `supabase/migrations/*.sql`** (aplicadas via Supabase CLI).
`schema.sql` é só um snapshot de leitura — nunca editar à mão, regenerar com
`npm run supabase -- db dump --linked -f supabase/schema.sql` depois de cada migration nova.

## Setup (primeira vez)

1. Crie um projeto novo em [supabase.com](https://supabase.com) (nome sugerido: `pitchat`).
2. Nas API settings do projeto, use o **novo modelo de keys** do Supabase (não o legado
   anon/service_role): copie a **Publishable key** (`sb_publishable_...`) e a **Secret key**
   (`sb_secret_...`). Preencha `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL` e `SUPABASE_URL` → a Project URL (mesmo valor nas duas)
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` → a Publishable key
   - `SUPABASE_SECRET_KEY` → a Secret key (nunca em `.env.example`, docs, migration ou Git)
3. Autentique e linke o CLI — ver "Autenticação não-interativa do CLI" abaixo (necessário
   sempre que o shell não for um terminal interativo de verdade, ex: agente/CI):
   ```bash
   npm run supabase -- projects list
   npm run supabase -- link --project-ref rvkyslzkzzyhxbjwxdyx
   ```
4. Aplique as migrations: `npm run supabase -- db push --dry-run` (revisa antes) e depois
   `npm run supabase -- db push`.
5. Crie seu usuário em **Authentication → Users → Add user** (defina senha lá).
6. Adicione seu e-mail em `PITCHAT_ALLOWED_EMAILS` no `.env.local`.
7. Crie manualmente seu workspace inicial e sua membership (ainda não existe UI pra isso na Fase 1):

   ```sql
   insert into workspaces (name, slug) values ('Minha Empresa', 'minha-empresa') returning id;
   -- copie o id retornado e o seu auth.users.id (Authentication → Users → clique no usuário)
   insert into workspace_members (workspace_id, user_id, role) values ('<workspace_id>', '<seu_user_id>', 'owner');
   ```

8. `npm run dev`, acesse `/login`.

## Autenticação não-interativa do CLI

`supabase login` abre um navegador e espera você aprovar — não funciona em shell não-TTY
(agente, CI, etc: o próprio CLI recusa com `Cannot use automatic login flow inside
non-TTY environments`). A alternativa oficialmente suportada é autenticação por variável
de ambiente, que é o que `scripts/supabase-cli.mjs` automatiza.

**As 3 credenciais deste projeto são coisas diferentes — não confundir:**

| Variável | O que é | Onde usa |
|---|---|---|
| `SUPABASE_SECRET_KEY` | Credencial server-side da **aplicação** PITCHAT | `lib/supabase/admin.ts` (runtime) |
| `SUPABASE_ACCESS_TOKEN` | Personal Access Token da **sua conta** Supabase | Só o CLI (Management API) |
| `SUPABASE_DB_PASSWORD` | Senha do **Postgres deste projeto** | Só o CLI (`link`, `db push`) |

Onde conseguir as duas que faltam pro CLI:
- `SUPABASE_ACCESS_TOKEN` → https://supabase.com/dashboard/account/tokens (criar um novo)
- `SUPABASE_DB_PASSWORD` → dentro do projeto, Settings → Database → Reset database password
  (se você não guardou a senha definida na criação)

Cole os dois em `.env.local` (`SUPABASE_ACCESS_TOKEN=` e `SUPABASE_DB_PASSWORD=`) — nunca em
`.env.example`, docs, migration ou código. `.env.local` já está no `.gitignore`.

**Uso** (o script carrega as duas variáveis de `.env.local`, nunca imprime os valores, e
injeta `--password` automaticamente em `link`/`db push`/`db pull`/`db diff`):

```bash
npm run supabase -- projects list                          # read-only, confirma que autenticou
npm run supabase -- link --project-ref rvkyslzkzzyhxbjwxdyx
npm run supabase -- db push --dry-run                       # sempre revisar antes
npm run supabase -- db push
npm run supabase -- migration list --linked
```

(O `--` depois de `supabase` é necessário pro npm repassar os argumentos seguintes pro
script em vez de tentar interpretá-los como flags do próprio `npm run`.)

## Workflow de migrations (a partir de agora)

```bash
# criar uma migration nova (só cria o arquivo local, não toca na rede — não
# precisa do wrapper com token/senha)
npx supabase migration new nome_da_mudanca

# editar o arquivo gerado, revisar o que vai ser aplicado, depois aplicar
npm run supabase -- db push --dry-run
npm run supabase -- db push

# conferir o que já foi aplicado vs. o que falta
npm run supabase -- migration list --linked

# regenerar o snapshot de leitura depois de aplicar
npm run supabase -- db dump --linked -f supabase/schema.sql
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
- `0003_media_processing_state` — estado de processamento do pipeline de ingest da Media
  Library (`status`/`processing_error`/`uploaded_by` em `media_assets`; `sha256` vira opcional
  com índice único parcial só para `status='ready'`).
