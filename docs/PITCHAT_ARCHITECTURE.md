# PITCHAT — Arquitetura

> Documento vivo. Atualizar a cada fase concluída (ver seção 12, Roadmap).

## 1. Visão

> **Mudança oficial de escopo (09/09/2026)**: a partir desta data, o PITCHAT V1 é **o nosso próprio ManyChat para Instagram** — foco absoluto no fluxo comentário → keyword match → resposta pública → private reply/DM → interação → continuação de flow → delay → condition → follow-up → Inbox + logs. Ver seção 12 (roadmap técnico A–K, histórico) e seção 13 (roadmap atual de produto / Signal Desk V2) — são dois roadmaps distintos com letras repetidas.

PITCHAT é a plataforma interna para automação de Instagram (estilo ManyChat, só com o que a operação realmente usa) e Inbox operacional, com arquitetura pronta para, no futuro, ganhar Media Library avançada e publicação/agendamento sem reescrita.

**CONGELADO nesta fase** (código existente preservado, sem refactor grande, sem novo desenvolvimento até decisão explícita de retomada): Media Library (upload, fingerprint perceptual, deduplicação), integração com Google Drive, e qualquer feature de publicação/agendamento/calendário/TikTok Publisher/estilo mLabs. Nada disso é deletado; apenas não recebe trabalho novo. Ver seção 8 (marcada como congelada) e seção 12.

## 2. Stack (decidida com o usuário em 08/09/2026)

| Camada | Escolha | Motivo |
|---|---|---|
| Framework | Next.js 16.3.4 (App Router, Turbopack), React 19.2.4, TypeScript 5 | Consistência com o PitBrain (projeto irmão). Versões conferidas contra `package.json`/`node_modules` em 26/09/2026 (inicialmente 16.2.9 em 08/09) |
| Estilo | Tailwind CSS v4 + shadcn/radix | Idem |
| Banco/Auth/Storage | Supabase — **projeto próprio e isolado**, não compartilha nada com o PitBrain | Isolamento de dados explicitamente pedido pelo usuário |
| Hospedagem | Vercel (serverless) | Consistência; barato; mas ver limitação de execução longa abaixo |
| Fila / Delay / Retry | **Upstash QStash** | Vercel é serverless — não segura `setTimeout` de minutos. QStash é fila HTTP gerenciada com delay e retry nativos, sem precisar manter um worker sempre ligado |
| Testes | Vitest 5 | Leve, roda bem em TS/ESM sem config extra |

Outras dependências relevantes (`package.json`, 26/09/2026): `@supabase/supabase-js` ^2.108, `@supabase/ssr` ^0.12, `@upstash/qstash` ^2.7, ESLint 9. `@xyflow/react` **não** está instalado (entra só na Fase E2 de produto).

### Supabase — novo modelo de API keys (decidido 08/09/2026)

Supabase está descontinuando as keys legadas `anon`/`service_role` (JWT) em favor de
`sb_publishable_...` / `sb_secret_...` (ver [changelog oficial](https://supabase.com/changelog/29260-upcoming-changes-to-supabase-api-keys)
e [guia de migração](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys)).
Client libraries (`@supabase/supabase-js`, `@supabase/ssr`) aceitam as novas keys sem
mudança de versão — é troca de valor, não de código de integração. PITCHAT já nasce
nesse padrão, com nomes de env explícitos (nunca os legados):

| Variável | Onde é usada | Conteúdo |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Browser (`lib/supabase/browser.ts`) | Project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser + server agindo como o usuário logado (`browser.ts`, `server.ts`, `middleware.ts`) | `sb_publishable_...` |
| `SUPABASE_URL` | Server-only (`server.ts`, `middleware.ts`, `admin.ts`) | Mesma Project URL, em nome sem `NEXT_PUBLIC_` |
| `SUPABASE_SECRET_KEY` | Server-only, só `admin.ts` (`getSupabaseAdminClient`) | `sb_secret_...` — bypassa RLS, nunca no bundle do browser |

`lib/supabase/admin.ts` importa o pacote `server-only` — qualquer import acidental
desse arquivo a partir de um Client Component quebra o build, em vez de vazar a
secret key silenciosamente pro bundle do navegador.

### Por que QStash em vez de fila em Postgres

Avaliamos "tabela de jobs + Vercel Cron" (zero infra nova) vs QStash (infra gerenciada extra). O usuário escolheu QStash explicitamente. Trade-off registrado: QStash exige uma conta Upstash e um novo secret (`QSTASH_TOKEN`, `QSTASH_CURRENT_SIGNING_KEY`, `QSTASH_NEXT_SIGNING_KEY`), mas dá delay/retry/backoff nativos via HTTP callback assinado — sem precisar implementar poller nem lidar com `SELECT ... FOR UPDATE SKIP LOCKED`.

### Next.js 16 — pontos que mudam código gerado por IA (lido em `node_modules/next/dist/docs` antes de escrever qualquer rota)

- `params`/`searchParams` em `page`/`layout`/`route` são **Promise** — sempre `await`.
- `middleware.ts` foi renomeado para **`proxy.ts`**, export `proxy()` (não `middleware()`). Roda em runtime `nodejs`, sem opção de `edge`.
- `next lint` foi removido — lint roda via `eslint` direto (script já ajustado no `package.json`).
- Turbopack é o padrão de `next dev`/`next build` (não precisa mais de `--turbopack`).
- `fetch` não é cacheado por padrão (igual Next 15).

## 3. Modelo conceitual

```
Workspace
  └─ Profiles (persona configurável — "Papagaio", "Dodo" etc. SEMPRE dado, nunca hardcode)
       └─ Social Accounts (Instagram, via OAuth oficial da Meta)
            ├─ Automations (versionadas) → Automation Runs → Automation Run Steps
            ├─ Contacts → Conversations → Messages
            ├─ Comments
            └─ Media Usage (referencia Media Assets, que são globais ao workspace)
Media Assets (globais ao workspace, deduplicados por SHA-256 + fingerprint perceptual)
Links / UTM (por perfil)
Webhook Events (brutos, idempotentes, processados via fila)
Audit Log
```

## 4. Autenticação e autorização

Reaproveitando o padrão do PitBrain (allowlist de e-mail, sem cadastro público):

- Supabase Auth (email/senha), usuário criado manualmente no dashboard do Supabase.
- `PITCHAT_ALLOWED_EMAILS` (env, lista separada por vírgula) — e-mail fora da lista é deslogado na hora (`lib/auth/allowed-emails.ts` + `proxy.ts`).
- Cada usuário pertence a 1+ `workspace` via `workspace_members` (papel: `owner` | `admin` | `member`).
- **Diferença importante em relação ao PitBrain**: PITCHAT já nasce multi-workspace de verdade (o PitBrain trata basicamente 1 workspace por empresa). Toda tabela de domínio carrega `workspace_id` e tem RLS policy exigindo `workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())`. Rotas server-side usam `service_role` (bypassa RLS) e portanto **precisam validar `workspace_id` manualmen­te no handler** — RLS aqui é defesa em profundidade, não a única barreira.

## 5. Integrações Meta — o que é oficialmente suportado hoje

Levantamento feito em cima da documentação oficial (`developers.facebook.com`) em 08/09/2026. Detalhe completo em [`PITCHAT_META_INTEGRATION.md`](./PITCHAT_META_INTEGRATION.md). Resumo das decisões que afetam o modelo de dados:

1. **Auth**: "Instagram API with Instagram Login" (sem exigir Página do Facebook vinculada). Permissions: `instagram_business_basic`, `instagram_business_manage_messages`, `instagram_business_manage_comments`, `instagram_business_content_publish` (não usada no V1, mas o escopo de token pode incluir por padrão de app review — não ativar a feature).
2. **Standard Access** (contas que o próprio workspace possui) não exige App Review. Como o PITCHAT vai gerenciar contas de terceiros/clientes eventualmente, isso pode exigir **Advanced Access + App Review + Business Verification** — não documentado de forma 100% explícita e literal numa única página; tratar como bloqueio conhecido a validar com a Meta antes de escalar para múltiplos clientes externos.
3. **Private Reply**: janela de **7 dias** após o comentário; **uma única** private reply por comentário, para sempre; rate limit 750/h (post/reel) ou 100/s (live).
4. **Send API**: janela padrão de **24h** desde a última mensagem do usuário; fora disso só com **Human Agent tag** (só humano, até 7 dias, proibido para conteúdo promocional) — nenhuma automação pode aplicar essa tag sozinha.
5. **Webhooks**: verificação via `hub.challenge`, assinatura `X-Hub-Signature-256` (HMAC SHA-256 com o App Secret) — validação não é tecnicamente obrigatória mas é mandatória no nosso design (nunca confiar em payload não assinado).
6. **Rate limits gerais**: fórmula `4800 × impressões/24h` para Graph API; Send API 100 req/s (texto), 10 req/s (mídia).

### Limitações conhecidas (documentar sempre que a automação tentar passar disso)

- Não é possível mandar 2ª private reply pro mesmo comentário — se o fluxo tentar, o node `PRIVATE_REPLY` deve falhar de forma clara (`error.code = "META_PRIVATE_REPLY_ALREADY_SENT"`), nunca silenciar.
- Fora da janela de 24h sem Human Agent tag, `SEND_MESSAGE` deve falhar explicitamente (`META_OUTSIDE_MESSAGING_WINDOW`) — a automação **não** pode aplicar Human Agent tag sozinha (violaria a política — só humano pode).
- Preferência declarada da Meta entre Instagram Login vs Facebook Login para apps novos: **não documentada claramente**. Decisão nossa: Instagram Login (mais simples, não depende de Página).
- Lista exaustiva de quais message tags (além de Human Agent) valem pra Instagram: **não documentada claramente**. Não implementar nenhuma tag além de Human Agent sem confirmar na prática (sandbox) antes.

## 6. Modelo de dados (visão geral — DDL completo em `supabase/schema.sql`)

```
workspaces, workspace_members, users (auth.users do Supabase)

profiles                         -- persona configurável
social_accounts                  -- 1 IG account por linha, token cifrado

contacts
conversations
messages
comments

automations, automation_versions
automation_runs, automation_run_steps

tags, contact_tags
custom_field_definitions, custom_field_values

webhook_events                   -- eventos brutos da Meta, idempotentes

media_assets, media_fingerprints, media_usage, media_duplicate_reviews

links                            -- UTM builder

audit_logs
jobs                             -- espelho local do que foi enfileirado no QStash (auditoria/retry)
```

Todas as tabelas de domínio (exceto `workspaces` e `media_assets`, que amarram direto no workspace) carregam `workspace_id`. Nomes de perfil (`Papagaio`, `Dodo`...) **nunca aparecem em código** — são linhas em `profiles.name`.

### 6.1 Uso real de `audit_logs`, `jobs` e `links` (auditado no código em HEAD `2648ab6`, 26/09/2026)

Conferido por busca em `app/`, `lib/`, `components/`. Não agrupar as três como "sem uso":

| Tabela | Estado | Quem usa |
|---|---|---|
| `audit_logs` | **EM USO** (escrita) | `app/api/conversations/[id]/automation/route.ts` → `conversation.human_takeover` e `conversation.automation_reactivated`; `app/api/comments/[id]/reply/route.ts` → `comment.manual_public_reply`; `app/api/jobs/resume-automation-run/route.ts` → `automation.yielded_to_human` |
| `jobs` | **EM USO, escopo estreito** | Escrita só em `app/api/cron/refresh-meta-tokens/route.ts` (`type = refresh_meta_token`). Leitura em `app/dashboard/health/page.tsx` (alimenta `classifyTokenMaintenanceHealth`/`classifyQstashHealth` em `lib/health/aggregate.ts`). **Não** é espelho geral de tudo que vai ao QStash (delay, retry, webhook não gravam em `jobs`) — o próprio Health avisa que "só o refresh de token grava em `jobs` hoje" |
| `links` | **SEM USO** | Nenhuma referência em `app/`, `lib/` ou `components/` (só existe no schema). UTM builder continua não implementado |

### 6.2 `supabase/schema.sql` — snapshot, não fonte de verdade

As **migrations** (`supabase/migrations/`) são a fonte de verdade; `schema.sql` é só snapshot de leitura (procedimento no `supabase/README.md`: `db dump --linked`, que exige Docker/Podman).

Estado em 26/09/2026: a checagem por conteúdo indica que o snapshot **provavelmente acompanha** as migrations mais recentes (contém `conversations.last_read_at`, não contém mais `comments.matched_automation_id`/`automation_processed_at`), mas isso **não foi verificado por dump** — Docker não está instalado nesta máquina. Snapshot: **pendente de confirmação por dump**; nunca editar `schema.sql` manualmente.

## 7. Fluxo de webhook (nunca processar automação dentro da request)

```
Meta → POST /api/webhooks/meta
  → valida assinatura (X-Hub-Signature-256)
  → persiste em webhook_events (status=PENDING, idempotency key = external_event_id)
  → responde 200 imediatamente
  → publica no QStash (delay=0) apontando pra /api/jobs/process-webhook-event
QStash → POST /api/jobs/process-webhook-event (assinado, verificado com QSTASH_CURRENT_SIGNING_KEY)
  → carrega o webhook_event, se já processed_at != null, no-op (idempotência)
  → roteia pro motor de automação
  → marca processed_at
```

Delay de automação (`DELAY` node) usa o mesmo mecanismo: QStash agenda o próximo step com `Upstash-Delay` e um callback assinado apontando pro `automation_run_id` + `step_index` a retomar.

## 8. Media Library — identidade sem depender de filename ⚠️ CONGELADO (09/09/2026)

> **Distinção importante (24/09/2026)**: a Media Library segue CONGELADA **como feature** (upload pipeline, fingerprint, Drive, publisher, scheduler — nada retomado). Na Fase A de produto (Quick Polish) houve apenas um **refit visual limitado** das páginas `app/dashboard/media/*` para os tokens do SIGNAL DESK (commit `f6522d2`). Isso é só apresentação; não reabriu nenhum trabalho de feature.

> Esta seção descreve código já existente (`app/dashboard/media/*`, `app/api/media/*`, `lib/media/*`, tabelas `media_assets`/`media_fingerprints`/`media_usage`/`media_duplicate_reviews`). **Não desenvolver, não refatorar, não corrigir bugs aqui** até nova decisão explícita — inclusive: sem suporte a vídeo grande, sem TUS, sem novo fingerprint, sem exclusão de código. Mantida apenas como referência histórica.

Pipeline de import (upload direto ou Google Drive):

```
arquivo → storage temporário → ffprobe (duração, resolução, fps, codec, bitrate)
        → SHA-256 → EXACT_DUPLICATE? (mesmo hash) → aponta pro asset existente, não duplica
        → se não: fingerprint perceptual (amostragem de frames + phash + fingerprint de áudio)
        → score de similaridade com assets existentes → PROBABLE_DUPLICATE (mostra score) | NEW_ASSET
        → grava media_assets (nunca usa filename como identidade — só guarda original_filename pra humano)
```

`media_usage` é a tabela que separa "existe" de "foi usado" — permite o mesmo asset em múltiplos perfis sem duplicar o arquivo físico.

## 9. Motor de automação (grafo versionável)

`automation_versions.graph` é JSON (`{nodes: [...], edges: [...]}`), versão publicada é imutável — quem já está executando uma versão antiga termina nela. Nodes do V1 (seção 13 do briefing original): `TRIGGER_COMMENT`, `KEYWORD_MATCH`, `PUBLIC_REPLY`, `PRIVATE_REPLY`, `SEND_MESSAGE`, `QUICK_REPLY`, `DELAY`, `CONDITION`, `ADD_TAG`, `REMOVE_TAG`, `SET_CUSTOM_FIELD`, `HTTP_REQUEST` (com proteção SSRF), `RANDOM_SPLIT`, `END`.

Cada execução gera `automation_runs` + `automation_run_steps` (uma linha por step, com `input`/`output`/`error`/`started_at`/`completed_at`) — é a base de observabilidade pedida (seção 22/53 do briefing: "por que esse usuário recebeu ou não essa mensagem").

## 10. Segurança (checklist aplicado desde a Fase 1)

- Token de Instagram cifrado em repouso (`social_accounts.access_token_encrypted`), nunca no client.
- `service_role` do Supabase só em código server-side (nunca em componente client).
- Webhook: assinatura obrigatória, idempotência por `external_event_id`.
- `HTTP_REQUEST` node: bloqueio de SSRF (nega `localhost`, `127.0.0.1`, ranges privados `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` — inclusive endpoint de metadata cloud).
- Upload: limite de tamanho + validação de MIME real (não só extensão).
- Rate limiting nas rotas de API.

### 10.1 Env vars da Vercel — origem e status (achado real, 24/09/2026)

Listando `env:list` via `scripts/vercel-api.mjs` (API REST da Vercel), 10 variáveis do projeto (`POSTGRES_URL`, `POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`, `POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE`, `SUPABASE_URL`, `SUPABASE_JWT_SECRET`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` — repare que alguns nomes colidem com os que a aplicação usa de verdade) parecem ter sido criadas automaticamente por uma **integração nativa Vercel↔Supabase** (marketplace), não pelo setup manual documentado em `supabase/README.md`.

**Confirmado**: nenhum código em `app/`/`lib/` lê `POSTGRES_*` — grep no projeto inteiro não achou nenhuma ocorrência. As variáveis que a aplicação de fato usa são as SEM esse padrão de integração: `SUPABASE_URL`/`SUPABASE_SECRET_KEY`/`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (ver `lib/supabase/admin.ts`/`browser.ts`), que coexistem na Vercel com as da integração sob nomes parecidos mas não idênticos.

**Status: `integration-managed`, aparentemente não usadas.** Não removidas ainda — decisão explícita do usuário de adiar até uma auditoria própria (confirmar se alguma outra ferramenta/dashboard da integração depende delas antes de apagar). Não remover sem esse passo.

## 11. Riscos / bloqueios conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| ~~Webhook exige app em Live + Advanced Access + Business Verification~~ — **RESOLVIDO (24/09/2026)**: app em Live + conta própria (Standard Access) já bastou pra entrega real funcionar; Advanced Access/Business Verification só voltam a importar pra gerenciar contas de terceiros (linha abaixo) | ~~Bloqueava o gatilho automático~~ — nenhum, confirmado com tráfego real | N/A |
| Advanced Access + Business Verification também exigidos separadamente para gerenciar contas de terceiros (modelo Tech Provider) | Bloqueia onboarding de clientes externos — mas como webhook já exige isso pra QUALQUER conta (ver risco acima), essa distinção deixou de importar na prática | N/A — vai ser resolvido junto com o risco acima |
| Estrutura exata do webhook `message_reactions` não vem com JSON literal na doc oficial (só descrição textual) | Parser pode precisar ajuste após primeiro evento real | Tratar como best-effort, logar payload bruto, ajustar após teste ponta a ponta real |
| Comportamento pós-expiração do long-lived token (60 dias) não documentado explicitamente | Pode exigir reconexão manual sem aviso claro | `social_accounts.status` já modela `expired`/`error`; health check na UI deve avisar antes de expirar |
| Projeto Supabase / conta Upstash-QStash — status de configuração real não confirmado nesta auditoria | Pode bloquear persistência/delay real | Confirmar com o usuário; enquanto faltar, rotas já falham explícito (`META_NOT_CONFIGURED`/QStash not configured), nunca fingem sucesso |

## 12. Roadmap TÉCNICO A–K (histórico — substituído em 09/09/2026)

> ⚠️ **Existem DOIS roadmaps com letras A–G/K.** Este (seção 12) é o **roadmap técnico original**, fases A–K (A = Meta/OAuth, B = Webhooks, I = Inbox, K = Hardening...). O roadmap de **produto/UI** mais recente (A = Quick Polish, B = Premium Shell, C = Inbox + Contacts V2...) está na **seção 13**. Ao escrever "Fase B concluída", sempre qualificar: "Fase B técnica (Webhooks)" ou "Fase B de produto (Premium Shell)".

O roadmap anterior (Fase 0–12, com Media Library nas Fases 2–3) está **substituído** pelo plano abaixo. Auditoria de 09/09/2026 mostrou que boa parte da fundação de automação já está implementada e testada — o roadmap reflete isso (fases marcadas `[x]` já têm código funcional, ainda não testado contra API real da Meta por falta de Meta App).

- [x] **Fase A** — Meta Integration research + connection: pesquisa oficial atualizada (`PITCHAT_META_INTEGRATION.md`), OAuth (`lib/meta/oauth.ts`, `app/api/auth/meta/*`) e UI de Social Accounts já implementados — falta testar contra Meta App real
- [x] **Fase B** — Webhooks + normalização de eventos: `app/api/webhooks/meta/route.ts` (verificação, assinatura, idempotência, fila QStash) + `lib/meta/events.ts` já implementados
- [x] **Fase C** — Comments + Contacts + Conversations (estado real em HEAD `2648ab6`, revisado 26/09/2026):
  - ✅ Upsert idempotente de contact/conversation em `lib/automation/ingest.ts`.
  - ✅ **UI de Contacts implementada**: `app/dashboard/contacts/page.tsx` (lista) e `app/dashboard/contacts/[id]/page.tsx` (detalhe). Ainda **sem E2E dedicado** da tela/fluxo de contato como marco separado (só a timeline do Inbox foi validada).
  - ✅ **`ingestInstagramMessage()` existe** (DM avulsa, sem quick reply): cria/atualiza `contact`, cria/atualiza `conversation`, grava a mensagem inbound em `messages` e ela aparece no Inbox. Ignora o eco de mensagem da própria conta (`IGNORED_OWN_MESSAGE`).
  - ❌ **DM avulsa NÃO inicia `automation_run` nova.** O trigger automático do V1 continua sendo **comentário** (`TRIGGER_COMMENT`), mais os resumes de quick reply/postback já existentes (`ingestInstagramQuickReply` → `claimWaitingRun`). Trigger por DM é decisão futura, não bug.
- [x] **Fase D** — Automation Engine mínimo: grafo + 13 node types + testes (`lib/automation/{graph,node-handlers,engine}.ts`)
- [x] **Fase E** — Public Reply + Private Reply: implementado em `lib/meta/client.ts` + node handlers
- [x] **Fase F** — Quick Replies + resume flow: `buildQuickReplyPayload`/`parseQuickReplyPayload` em `lib/automation/engine.ts`, `ingestInstagramQuickReply` em `ingest.ts`
- [x] **Fase G** — QStash + Delay: `lib/qstash.ts`, `app/api/jobs/resume-automation-run/route.ts`, `claimWaitingRun` (lock atômico)
- [x] **Fase H** — Conditions + Tags + Fields: node types `CONDITION`/`ADD_TAG`/`REMOVE_TAG`/`SET_CUSTOM_FIELD` implementados
- [x] **Fase I** — Inbox + Human Takeover: **concluída e E2E validada em produção (24/09/2026)**, ver marco abaixo. Hoje existem: ✅ Inbox, ✅ UI de Contacts, ✅ timeline (comments + messages + steps), ✅ contexto de post por comentário, ✅ distinção comentário vs DM, ✅ Human Takeover, ✅ reativação, ✅ DM manual, ✅ resposta pública manual, ✅ `audit_logs` correspondentes (ver seção 6.1). Contacts: interface funcional, sem E2E dedicado.
- [~] **Fase J** — Automation Editor: CRUD completo (`app/api/automations/**`) + editor sequencial V1 (`app/dashboard/automations/**`, `lib/automation/flow-spec.ts`) implementados em 09/09/2026, com o flow de referência "Instagram Comment → DM Test" disponível via botão de seed. Estado em `2648ab6` (conferido em `flow-spec.ts`): ✅ editor sequencial V1 existe; `RANDOM_SPLIT`/`HTTP_REQUEST` são suportados pelo engine mas **não expostos** no editor (`flow-spec.ts` os trata como "não suportados pelo editor sequencial V1"); `CONDITION` continua limitado — saída `true` segue a lista, saída `false` vai sempre direto ao `END`; ❌ canvas visual não existe; ❌ `validateGraph` autoritativo (backend) não existe. Ordem planejada: E1 `validateGraph` **antes** de E2 canvas `@xyflow/react` (seção 13).
- [x] **Fase K** — Hardening + teste ponta a ponta real: **concluída em 24/09/2026**, com tráfego real do Instagram (ver marco abaixo). Hardening P0 **concluído** (não está mais em andamento):
  - ✅ refresh automático de long-lived token (cron diário `app/api/cron/refresh-meta-tokens`, grava em `jobs` com `type = refresh_meta_token`) e estados de outcome (`refresh_success`, `refresh_retryable_failure`, `refresh_non_retryable_failure`, `reauth_required` — `lib/meta/token-maintenance.ts`)
  - ✅ `SOCIAL_ACCOUNT_NOT_FOUND` explícito (não é mais processado silenciosamente)
  - ✅ gate de revisão obrigatório antes de publicar automação
  - ✅ retry automático de `MetaApiError` `RETRYABLE` com backoff de **1 / 5 / 15 min** via QStash (`lib/automation/retry-policy.ts`; esgotadas as tentativas, a run falha de vez)
  - ✅ Health Dashboard (`/dashboard/health`)
  - ✅ logs sensíveis revisados (assinatura de webhook truncada, nunca HMAC completo)
  - ✅ `automation.yielded_to_human` registrado em `audit_logs`
  - Melhoria de observabilidade (**não** bug bloqueante): gravar o `external reply id` retornado pelo `PUBLIC_REPLY`.
  - Snapshot `supabase/schema.sql`: ver seção 6.2.

> **✅ MARCO — E2E real validado em produção (24/09/2026)**: os 7 passos abaixo, que definiam o critério de "funcionando de verdade" desde 09/09/2026, foram todos confirmados com tráfego real do Instagram (não simulado, não reprocessado manualmente) na conta de teste `@papagaio_milhas`:
> 1. ✅ Meta App criado, configurado e **Live**
> 2. ✅ OAuth real conectando o Instagram profissional de teste
> 3. ✅ Webhook + subscription reais — assinatura validando com `INSTAGRAM_APP_SECRET` (achado real, ver `PITCHAT_META_INTEGRATION.md` §3; **não** é o `META_APP_SECRET` que a doc antiga desta fase presumia)
> 4. ✅ Comentário real recebido → normalizado → persistido em `webhook_events`/`comments`/`contacts`/`conversations`
> 5. ✅ `automation_run` iniciado → `PUBLIC_REPLY` real (comentário público visível) → `PRIVATE_REPLY` real (DM confirmada por **read receipt** do destinatário, não só pelo `message_id` retornado)
> 6. ✅ Clique real em Quick Reply → `messaging_postbacks` → `claimWaitingRun` retomou a **mesma** `automation_run` (nunca criou uma nova) → `SEND_MESSAGE` real com Button Template (`web_url`, sem URL crua em texto)
> 7. ✅ `DELAY` real de 2 minutos via QStash → callback → retomada → follow-up real → `automation_run.status = completed`
>
> Cadeia completa provada numa única run real: `comentário → webhook → QStash → engine → KEYWORD_MATCH → PUBLIC_REPLY → PRIVATE_REPLY (com quick reply anexado, sem bubble duplicada) → clique → resume → Button Template → DELAY → QStash resume → follow-up → END`.
>
> Bugs reais encontrados e corrigidos nesse processo (não achados por teste automatizado — só apareceram contra a API real): ID da conta gravado errado no OAuth (app-scoped vs. real), secret errado validando o webhook (`META_APP_SECRET` vs. `INSTAGRAM_APP_SECRET`), e bubble duplicada no Quick Reply (texto repetido em duas mensagens separadas). Detalhes e commits em `PITCHAT_META_INTEGRATION.md`.
>
> Com o E2E mínimo fechado, a prioridade (então) era hardening P0 antes de Inbox/Contacts/editor visual. **Esse hardening P0 já foi concluído** (lista na Fase K acima).

> **✅ MARCO — Inbox + Human Takeover E2E validado em produção (24/09/2026)**, na mesma conta de teste `@papagaio_milhas` (contato `@paulo.cadoxd`):
> 1. ✅ "Assumir controle" real — `conversations.automation_enabled = false`, gravado em `audit_logs` (`conversation.human_takeover`)
> 2. ✅ Comentário real feito com automação desligada → **nenhuma** `automation_run` criada (gate checado em `ingestInstagramComment`) — confirmado em dois comentários reais e distintos da Meta (não é o mesmo evento reprocessado)
> 3. ✅ Reativação real — `automation_enabled = true`, gravado em `audit_logs` (`conversation.automation_reactivated`) → comentário seguinte voltou a disparar a automação normalmente numa `automation_run` real
> 4. ✅ Envio manual de DM durante o takeover — mensagem enviada e confirmada recebida do lado do contato
> 5. ✅ Timeline do Inbox (comments + messages + automation_run_steps) validada visualmente em produção, incluindo o contexto de post por comentário (ver achado abaixo) e o rótulo "Comentário"/"Mensagem" por entrada
> 6. ✅ "Responder publicamente" — **E2E real confirmado (24/09/2026, 22:03 UTC)**: clique real no comentário `987a6548…`, texto "🦜 Resposta pública manual de teste" apareceu no Instagram (confirmado visualmente), `audit_logs` foi de 0→1 (`comment.manual_public_reply`), sem criar DM, sem disparar `automation_run`, sem alterar `automation_enabled` — verificado por diff direto no banco antes/depois, não só pela UI
> 7. Contacts — UI implementada (lista + detalhe), sem teste E2E dedicado ainda
>
> Achado real nesse processo (não é bug — investigado e descartado com evidência): dois comentários reais "piada de papagaio" do mesmo contato, em dois posts diferentes, apareciam lado a lado na timeline com o mesmo texto — pareciam duplicata. Confirmado via `external_comment_id`/`external_media_id`/`webhook_events` distintos que eram dois eventos Meta genuinamente diferentes, cada um processado uma única vez. Corrigida a lacuna visual (não a ingestão): a timeline agora mostra "Comentário em post · `<id truncado>`" por entrada. Detalhes em `PITCHAT_META_INTEGRATION.md`.

**Correção de bug encontrada em 09/09/2026**: `lib/meta/events.ts` só reconhecia `messages`/`messaging_postbacks` no formato legado `entry.messaging[]` (Messenger/Facebook Page) — a doc oficial revalidada mostra que o envelope com exemplo confirmado é `entry.changes[].{field,value}` (mesmo formato de `comments`). Corrigido para aceitar os dois formatos; ver `docs/PITCHAT_META_INTEGRATION.md` §3.

**Gaps adicionais** (não bloqueantes, fora das fases acima; revisados 26/09/2026): falta teste dedicado para `lib/automation/ingest.ts`; editor V1 não expõe `RANDOM_SPLIT`/`HTTP_REQUEST` na UI (engine já suporta os dois). O item antigo "jobs/links/audit_logs sem uso" foi **corrigido**: ver seção 6.1 (audit real, tabela por tabela).

**Explicitamente CONGELADO** (código preservado, zero desenvolvimento novo até decisão explícita): Media Library (upload, storage, ffprobe, SHA-256, fingerprint perceptual, dedup), Google Drive, publicação, agendamento, calendário, scheduler, TikTok Publisher, qualquer feature estilo mLabs. (Refit visual da Media já feito na Fase A de produto — ver nota na seção 8; não é retomada da feature.)

## 13. Roadmap atual de Produto / Signal Desk V2

> Este é o roadmap de **produto/UI** (Fase A executada em 24/09/2026, Fase B em 25/09/2026). **Não confundir** com o roadmap técnico A–K da seção 12: as letras se repetem com significados diferentes. Design system e tokens: [`PITCHAT_DESIGN_SYSTEM.md`](./PITCHAT_DESIGN_SYSTEM.md).

| Fase | Nome | Estado (26/09/2026) |
|---|---|---|
| A | Quick Polish | ✅ concluída, validada visualmente em produção pelo Paulo |
| B | Premium Shell / Signal Desk V2 | ✅ implementada, validada visualmente pelo Paulo |
| C | Inbox + Contacts V2 | ✅ **concluída e validada visualmente pelo Paulo em produção** (HEAD validado `460cd6d`; ver 13.2) |
| D | Multi-Instagram | 🟡 **em andamento** — **D0 ✅ concluída e validada E2E**; **D1 (filtro por canal) 🟡 implementada, AGUARDANDO validação visual/E2E do Paulo** (ver 13.3/13.4/13.5); Fase D **não concluída** |
| E1 | Backend Graph Validator (`validateGraph` autoritativo) | ⏳ futura — vem **antes** de E2 |
| E2 | Automation Canvas (`@xyflow/react`) | ⏳ futura |
| F | YouTube | ⏳ futura |
| G | TikTok Capability Spike | ⏳ futura |

### 13.1 Fase B de produto — Premium Shell (estado real)

- ✅ **Thin Rail** de 64px (só ícones; substituiu a `Sidebar` de 216px) — `components/app-shell/rail.tsx`
- ✅ **TopBar** — `components/app-shell/top-bar.tsx`
- ✅ **ChannelSwitcher** — `components/app-shell/channel-switcher.tsx`, mostra contas reais de `social_accounts`. **"Todos os canais" é a única seleção funcional**; as contas individuais aparecem só como contexto visual. **Não existe filtragem por conta** em nenhuma tela.
- ✅ Mobile: contexto mínimo de canal no drawer.
- ⚠️ **Multi-Instagram NÃO está concluído** — o switcher é só a base visual da Fase D.

### 13.2 Fase C de produto — Inbox + Contacts V2 (✅ concluída e validada visualmente pelo Paulo em produção)

Fechada em 26/09/2026 — tests, lint, build e Vercel ok; Inbox V2, Contact Detail V2 e Button Template aprovados pelo Paulo em produção no HEAD `460cd6d`. Sem migration, sem alteração de schema. Design em `PITCHAT_DESIGN_SYSTEM.md` §11.2. O que mudou:

- **Timeline operacional** (`components/inbox/timeline.tsx`) no lugar de bolhas; `composeTimeline()` em `lib/inbox/repo.ts` compõe comentários + `messages` + sinais de engine.
- **Sinais de engine na timeline** (a partir de `automation_run_steps`, 2 queries bounded em paralelo): `KEYWORD_MATCH` (incl. "sem correspondência"), `CONDITION` (braço tomado), `DELAY`, `END`, `PUBLIC_REPLY`, e **qualquer step `failed`** (incidente). Deliberadamente **fora**: `SEND_MESSAGE`/`PRIVATE_REPLY`/`QUICK_REPLY` (duplicariam `messages`), tags/campos/HTTP/split. Cobertos por `__tests__/inbox-timeline.test.ts`.
- DM de automação carrega `messages.type`/`payload` p/ mostrar opções de quick reply e botão.
- Conversation list com avatar/fallback, conta receptora, rail de 2px, não lida, manual; painel de contexto do contato; Contacts (lista + detalhe) realinhados.
- **Avatares**: `contacts.avatar_url` é lido, mas nenhuma rotina de enrichment existe (nem foi investigada a capacidade real da Meta) — todos usam fallback de iniciais. Avatar enrichment é decisão futura separada.
- **Não mexido**: lógica/endpoints de Human Takeover, DM manual e resposta pública; Channel Switcher ("Todos os canais" segue única seleção; Inbox **não** filtra por conta — isso é a Fase D); `contacts` sem migration.
- `PUBLIC_REPLY` external reply id continua melhoria futura de observabilidade.
- **Observação não bloqueante**: a row de conversa do Contact Detail mostra "Sem mensagens ainda" quando só há comentário e nenhuma DM; uma copy mais precisa ("Sem DM ainda") pode ser avaliada no futuro.

### 13.3 Fase D — decisão sobre `contacts`: ✅ confirmada por E2E real, NÃO migrar

**Resultado do teste real (27/09/2026, produção): A ≠ B.** A mesma conta pessoal (`paulo.cadoxd`) comentou `PITCHAT-IDTEST-A` na IG01 `@papagaio_milhas` e `PITCHAT-IDTEST-B` na IG02 `@dodo_passagens`, e o webhook persistiu **IGSIDs diferentes**: A = `1120289020330867` (contact `e9f4c587-…`, conversation `9d6b60f8-…`), B = `1813191480038393` (contact `7d8ef491-…`, conversation `7857d3a6-…`). Confirmado: dois contacts distintos (mesmo username, `platform_user_id` diferente); conversations separadas por `social_account_id`; comentários ligados às contas receptoras corretas; webhook da Dodo processado normalmente; **nenhuma colisão** em `unique(workspace_id, platform, platform_user_id)`.

**Decisão oficial do V1:** NÃO migrar `contacts`, NÃO adicionar `social_account_id` a `contacts`, NÃO criar person-resolution, NÃO unificar contacts por username. **Semântica: Contact = identidade do usuário naquele canal/contexto Instagram**; a mesma pessoa real pode gerar contacts diferentes em contas profissionais receptoras diferentes — isso é esperado e correto.

**Nota de UX futura (D1+):** em "Todos os canais", o mesmo username pode aparecer em mais de uma linha (IGSIDs diferentes). **Isso não deve ser tratado como duplicata automaticamente.**

(Plano original do teste, mantido como histórico) Antes de conectar contas em escala, testar a mesma pessoa interagindo com IG01 e IG02:

- IG01 → `platform_user_id` A, IG02 → `platform_user_id` B, com **A ≠ B**: o schema atual já mantém identidades distintas — nada a migrar.
- **A == B**: reavaliar o schema de `contacts`.

**Nenhuma migration antes desse teste.** (Não é um bug conhecido; é uma dúvida a validar.)

### 13.4 Fase D0 — Multi-Instagram: código seguro para 2+ contas (✅ concluída e validada E2E em 27/09/2026)

**Semântica adotada (confirmada contra schema + engine, sem contradição estrutural):**

- **Profile** = persona + conjunto de automações. **Social accounts** = 1+ contas Instagram associadas ao profile (`social_accounts.profile_id`; UNIQUE só em `(platform, external_account_id)`, não em `profile_id`).
- **Automação pertence ao profile** e vale para **todas** as contas do profile (`ingestInstagramComment` → `loadActiveAutomations(socialAccount.profile_id)`). Se duas contas precisam de automações diferentes → **profiles diferentes**. Sem many-to-many automation↔social_account.
- Token/lookup nunca se misturam: webhook casa por `(platform, external_account_id)` (único); engine, DM manual e resposta pública usam `conversation/comment.social_account_id`; refresh de token e disconnect são por conta.

**Suposições de "1 conta por profile" encontradas e corrigidas:** (1) Social Accounts: `Map profile→conta` escondia a 2ª conta; (2) Editor de automação: `social_accounts … .maybeSingle()` por `profile_id` falha com 2+ linhas e mostrava "Nenhuma conta conectada" (perigoso na revisão de publicação); (3) callback OAuth: `upsert` reescrevia `workspace_id`/`profile_id` da linha existente — reassociava conta em silêncio; (4) "Reconectar" só carregava `profileId`, sem alvo; (5) lista de Automations rotulava profile como "Conta".

**Mudanças (sem migration, sem schema):**
- Social Accounts agrupada por profile (várias contas por profile, "Adicionar conta Instagram", Reconectar/Desconectar por conta) — `lib/social-accounts/repo.ts`.
- OAuth: `start?profileId=X` = **adicionar** conta; `&reconnect=<social_account_id>` = **reconectar ESTA conta**. A Meta não deixa pré-selecionar a conta que volta do OAuth, então o callback compara a identidade real autorizada com a conta-alvo e **recusa sem alterar nada** se forem diferentes (`wrong_account_authorized`). Conta já ligada a outro profile/workspace também é recusada; linha existente só tem credenciais atualizadas, nunca profile/workspace (`lib/meta/account-link.ts`, decisão antes de qualquer efeito colateral).
- Editor de automação lista as contas do profile e diz explicitamente que a automação vale para todas; diálogo de publicação idem. Lista de Automations: coluna "Perfil" + nº de contas conectadas.
- ChannelSwitcher, Inbox e Contacts **inalterados** (já usam `social_account_id`; switcher lista todas as contas, "Todos os canais" segue única seleção funcional).

**Contacts**: sem migration, `unique(workspace_id, platform, platform_user_id)` intacto. **Teste E2E de identidade: ✅ executado — A ≠ B (ver 13.3).** (Plano original do teste:) Paulo conecta IG02; a **mesma conta pessoal** comenta em IG01 (`PITCHAT-IDTEST-A`) e IG02 (`PITCHAT-IDTEST-B`); comparar `contacts.platform_user_id` real persistido: **A ≠ B** → schema atual ok, segue D1 (filtro); **A == B** → parar e trazer linhas reais + proposta mínima de migration para o Paulo decidir.

**Investigação do OAuth da 2ª conta (Dodo) — observabilidade primeiro (26/09/2026):** a 1ª tentativa de adicionar a IG02 falhou em produção com "Falha no exchange pra long-lived token: HTTP 400" e o body real da Meta era descartado. **Causa então desconhecida (resolvida neste caso por App Role — ver evidência ao final desta seção).** Implementado apenas diagnóstico: `InstagramOAuthError` (`lib/meta/oauth-errors.ts`) preserva `httpStatus`, `metaCode`, `metaSubcode`, `metaType`, `fbtrace_id` e a mensagem da Meta (com credenciais redigidas); o callback loga isso **server-side** (JSON `oauth_callback_failed`, nos logs da Vercel) e põe na URL só um `detail` categorizado (ex.: `long_lived_exchange_failed_http400_code100_sub33`) — nunca a mensagem técnica. Nenhum token, `code`, app secret ou URL de request é logado. Nenhuma mudança de endpoint/scopes/credenciais/schema; `decideAccountLink` continua antes de qualquer efeito colateral.

**Evidência E2E do teste de App Role (27/09/2026) — observada, sem generalizar:** a conta profissional `@dodo_passagens`, **sem App Role no app**, falhou no exchange long-lived com **HTTP 400 / code 100 / `IGApiException` / "Unsupported request - method type: get"** (subcode null; `fbtrace_id` no log da Vercel). **Depois de aceitar "Testador do Instagram"**, o **mesmo fluxo OAuth passou** e a conta foi conectada (`external_account_id` `17841478404164306`, mesmo profile da IG01). Isso mostra apenas que **o App Role resolveu ESTE caso de Standard Access**; **não** é prova de que Tech Provider Verification seja a causa geral, e **não** foi bug de GET/POST nem do D0 (o método/endpoint do `ig_exchange_token` não foi alterado). Implicação prática: contas sem App Role podem não conectar sob Standard Access — caminho de Advanced Access/App Review a auditar antes de conectar contas de terceiros.

**Status D0 (27/09/2026): ✅ CONCLUÍDA E VALIDADA E2E.** Fase D: 🟡 em andamento. **D1 (filtro por canal): 🟡 implementada — aguardando validação visual/E2E do Paulo (ver 13.5). Não marcar D1 ✅ automaticamente.**

### 13.5 Fase D1 — Channel Switcher vira filtro real (🟡 implementada, aguardando validação do Paulo)

**Modelo canônico**: a URL é a única fonte de verdade — sem `channel` = "Todos os canais"; `?channel=<social_accounts.id>` = canal específico. `?channel=all` é canonicalizado (redirect) pra ausência do param. Nunca cookie/localStorage/Context. `lib/channel/repo.ts` (`resolveChannel`/`listWorkspaceChannelAccounts`/`groupChannelAccountsByProfile`/`normalizeChannelParam`) e `lib/channel/url.ts` (hrefs) são a base; `lib/channel/deep-link.ts` decide a regra de conflito conversation×channel do Inbox (puro, testado).

- **Channel Switcher**: mesmo componente/Radix de antes, agora cada item é um `<Link>` real (nunca estado client-only) — preserva SSR/deep link/refresh/nova aba/Back-Forward. Contas agrupadas por profile (heading discreto, não accordion). Trocar de canal manualmente remove `conversation` da URL. Em `/dashboard/automations*` vira contextual ("Escopo por perfil", não filtra nada — automação é do profile).
- **Channel inválido nunca amplia o escopo**: Inbox/Contacts/Health mostram "Canal não encontrado ou não está mais conectado." + "Ver todos os canais", em vez de silenciosamente cair pra "todos".
- **Inbox**: `listConversations` filtra por `social_account_id` **na query, antes do `.limit()`**. Regra de deep link: `conversation` válida sempre vence um `channel` diferente (canonicaliza a URL); sem `channel`, mantém "Todos os canais". `ConversationRow` preserva `channel` ao abrir a thread. `MessageComposer` mostra "Respondendo como @conta" sempre que há conversation selecionada.
- **Contacts**: `listContacts` filtra por contatos com conversation naquele `social_account_id` (2 queries, antes do limite); A≠B (D0) nunca é mesclado — contas diferentes seguem linhas distintas mesmo com o mesmo username. `ContactRow`/Contact Detail preservam o `channel` de ida e volta; o link de cada conversation pro Inbox usa `channel=<conversation.social_account_id>`, nunca o canal navegado.
- **Health — filtro honesto por dataset** (nunca inventa atribuição que os dados não sustentam): Instagram Accounts e Webhook Events (`social_account_id`) e Automation Runs (via `conversation_id` das conversations do canal) filtram de verdade; Token Maintenance filtra por `jobs.payload->>socialAccountId`; **QStash/Jobs permanece GLOBAL e rotulado como tal** quando um canal está ativo (delay/retry/webhook não gravam `social_account_id` em `jobs` hoje); Incident Rail só inclui incidentes de job atribuíveis ao canal selecionado (usa a mesma query escopada de Token Maintenance), nunca de outra conta.
- **Automations**: sem filtro (automação é do profile, não da conta) — nenhuma mudança nas páginas, só o Switcher fica contextual.
- **Social Accounts**: sem filtro (gerencia o conjunto de canais); `channel` na URL é ignorado pela página.
- **Navegação**: Rail/MobileSidebar propagam `channel` (só esse param) ao trocar de seção — nunca desaparece ao clicar no Rail.
- **Testes novos**: `__tests__/channel-repo.test.ts`, `channel-deep-link.test.ts`, `channel-url.test.ts`, `channel-filter-repo.test.ts` (30 testes) — cobrem resolução/validação de channel, a regra de deep link, os helpers de URL e, principalmente, que o filtro do Inbox/Contacts acontece **antes do limite** (fixtures deliberadamente colocam o canal filtrado fora do "top N global").
- Sem migration, sem coluna nova, sem mudança em `contacts`.

**Status: D1 implementada. NÃO fechar como concluída** — falta a validação visual/E2E do Paulo (troca de canal, deep links, Health por conta) em produção.
