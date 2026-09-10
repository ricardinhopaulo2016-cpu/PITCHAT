# PITCHAT — Arquitetura

> Documento vivo. Atualizar a cada fase concluída (ver seção 12, Roadmap).

## 1. Visão

> **Mudança oficial de escopo (09/09/2026)**: a partir desta data, o PITCHAT V1 é **o nosso próprio ManyChat para Instagram** — foco absoluto no fluxo comentário → keyword match → resposta pública → private reply/DM → interação → continuação de flow → delay → condition → follow-up → Inbox + logs. Ver seção 12 (Roadmap) para as fases A–K vigentes.

PITCHAT é a plataforma interna para automação de Instagram (estilo ManyChat, só com o que a operação realmente usa) e Inbox operacional, com arquitetura pronta para, no futuro, ganhar Media Library avançada e publicação/agendamento sem reescrita.

**CONGELADO nesta fase** (código existente preservado, sem refactor grande, sem novo desenvolvimento até decisão explícita de retomada): Media Library (upload, fingerprint perceptual, deduplicação), integração com Google Drive, e qualquer feature de publicação/agendamento/calendário/TikTok Publisher/estilo mLabs. Nada disso é deletado; apenas não recebe trabalho novo. Ver seção 8 (marcada como congelada) e seção 12.

## 2. Stack (decidida com o usuário em 08/09/2026)

| Camada | Escolha | Motivo |
|---|---|---|
| Framework | Next.js 16.2.9 (App Router), React 19.2, TypeScript | Consistência com o PitBrain (projeto irmão) |
| Estilo | Tailwind CSS v4 + shadcn/radix | Idem |
| Banco/Auth/Storage | Supabase — **projeto próprio e isolado**, não compartilha nada com o PitBrain | Isolamento de dados explicitamente pedido pelo usuário |
| Hospedagem | Vercel (serverless) | Consistência; barato; mas ver limitação de execução longa abaixo |
| Fila / Delay / Retry | **Upstash QStash** | Vercel é serverless — não segura `setTimeout` de minutos. QStash é fila HTTP gerenciada com delay e retry nativos, sem precisar manter um worker sempre ligado |
| Testes | Vitest | Leve, roda bem em TS/ESM sem config extra |

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

## 11. Riscos / bloqueios conhecidos

| Risco | Impacto | Mitigação |
|---|---|---|
| **Webhook exige app em Live + Advanced Access + Business Verification — mesmo pra conta própria/tester** (correção 10/09/2026, achado testando E2E real: app-level e account-level subscription confirmadas ativas via API, payload assinado testado, mesmo assim ZERO entregas depois de 3 comentários reais; doc oficial confirma literalmente "Apps must be set to Live... to receive webhook notifications" + tabela de requisitos exige Advanced Access/Business Verification pra "Business Login for Instagram") | **Bloqueia o gatilho automático via comentário real até o usuário completar Business Verification + App Review + trocar o app pra Live** — não é um bug de código, é um portão externo da Meta | Checklist exato em `PITCHAT_META_INTEGRATION.md` §1.8-9, ação manual do usuário (documentos da empresa + submissão de review). OAuth/Send API/Private Reply continuam testáveis manualmente enquanto isso |
| Advanced Access + Business Verification também exigidos separadamente para gerenciar contas de terceiros (modelo Tech Provider) | Bloqueia onboarding de clientes externos — mas como webhook já exige isso pra QUALQUER conta (ver risco acima), essa distinção deixou de importar na prática | N/A — vai ser resolvido junto com o risco acima |
| Estrutura exata do webhook `message_reactions` não vem com JSON literal na doc oficial (só descrição textual) | Parser pode precisar ajuste após primeiro evento real | Tratar como best-effort, logar payload bruto, ajustar após teste ponta a ponta real |
| Comportamento pós-expiração do long-lived token (60 dias) não documentado explicitamente | Pode exigir reconexão manual sem aviso claro | `social_accounts.status` já modela `expired`/`error`; health check na UI deve avisar antes de expirar |
| Projeto Supabase / conta Upstash-QStash — status de configuração real não confirmado nesta auditoria | Pode bloquear persistência/delay real | Confirmar com o usuário; enquanto faltar, rotas já falham explícito (`META_NOT_CONFIGURED`/QStash not configured), nunca fingem sucesso |

## 12. Roadmap — substituído em 09/09/2026 (mudança oficial de escopo)

O roadmap anterior (Fase 0–12, com Media Library nas Fases 2–3) está **substituído** pelo plano abaixo. Auditoria de 09/09/2026 mostrou que boa parte da fundação de automação já está implementada e testada — o roadmap reflete isso (fases marcadas `[x]` já têm código funcional, ainda não testado contra API real da Meta por falta de Meta App).

- [x] **Fase A** — Meta Integration research + connection: pesquisa oficial atualizada (`PITCHAT_META_INTEGRATION.md`), OAuth (`lib/meta/oauth.ts`, `app/api/auth/meta/*`) e UI de Social Accounts já implementados — falta testar contra Meta App real
- [x] **Fase B** — Webhooks + normalização de eventos: `app/api/webhooks/meta/route.ts` (verificação, assinatura, idempotência, fila QStash) + `lib/meta/events.ts` já implementados
- [~] **Fase C** — Comments + Contacts + Conversations: upsert idempotente já existe em `lib/automation/ingest.ts`; falta UI dedicada de Contacts e trigger isolado a partir de mensagem direta (hoje só comentário dispara run)
- [x] **Fase D** — Automation Engine mínimo: grafo + 13 node types + testes (`lib/automation/{graph,node-handlers,engine}.ts`)
- [x] **Fase E** — Public Reply + Private Reply: implementado em `lib/meta/client.ts` + node handlers
- [x] **Fase F** — Quick Replies + resume flow: `buildQuickReplyPayload`/`parseQuickReplyPayload` em `lib/automation/engine.ts`, `ingestInstagramQuickReply` em `ingest.ts`
- [x] **Fase G** — QStash + Delay: `lib/qstash.ts`, `app/api/jobs/resume-automation-run/route.ts`, `claimWaitingRun` (lock atômico)
- [x] **Fase H** — Conditions + Tags + Fields: node types `CONDITION`/`ADD_TAG`/`REMOVE_TAG`/`SET_CUSTOM_FIELD` implementados
- [ ] **Fase I** — Inbox + Human Takeover: **não implementado** — sem UI, `messages` sem código de leitura, sem botão pausar/retomar automação
- [~] **Fase J** — Automation Editor: CRUD completo (`app/api/automations/**`) + editor sequencial V1 (`app/dashboard/automations/**`, `lib/automation/flow-spec.ts`) implementados em 09/09/2026, com o flow de referência "Instagram Comment → DM Test" disponível via botão de seed. Pendente: UI de Contacts (item 31), editor visual (canvas), CONDITION com segundo braço editável (V1 força `false` → END sempre)
- [ ] **Fase K** — Hardening + teste ponta a ponta real: pendente até existir Meta App configurado; inclui rodar `supabase db dump` pra sincronizar `schema.sql` com as migrations

> **Reprioridade em 09/09/2026**: Fase K passa a ser a prioridade máxima, à frente de Inbox (I)/Contacts/editor visual — ver `docs/PITCHAT_META_INTEGRATION.md` §0. Nenhum dos quatro fluxos críticos (OAuth, Webhook, Private Reply, Send API) conta como "funcionando" só por ter código+teste mockado — status correto é `IMPLEMENTED / NOT E2E VERIFIED` até rodar contra a API real. Ordem do primeiro teste real (checklist §1 do doc de integração é pré-requisito):
> 1. Meta App criado e configurado (ação do usuário)
> 2. OAuth real (conectar 1 Instagram profissional de teste)
> 3. Webhook/subscription real
> 4. Comentário real recebido → normalizado → persistido
> 5. `automation_run` iniciado → `PUBLIC_REPLY` real → `PRIVATE_REPLY` real
> 6. Interação/mensagem real recebida → run `waiting` correto identificado → flow continua → `SEND_MESSAGE` real
> 7. `DELAY` real via QStash (se credenciais já existirem) → follow-up real
>
> Trabalho em Inbox/CRUD/editor visual só avança enquanto o usuário estiver fazendo configuração manual no painel da Meta (não pode virar prioridade maior que fechar esse E2E).

**Correção de bug encontrada em 09/09/2026**: `lib/meta/events.ts` só reconhecia `messages`/`messaging_postbacks` no formato legado `entry.messaging[]` (Messenger/Facebook Page) — a doc oficial revalidada mostra que o envelope com exemplo confirmado é `entry.changes[].{field,value}` (mesmo formato de `comments`). Corrigido para aceitar os dois formatos; ver `docs/PITCHAT_META_INTEGRATION.md` §3.

**Gaps adicionais identificados na auditoria** (não bloqueantes, mas fora das fases acima): tabelas `jobs`, `links`, `audit_logs` existem no schema mas nenhum código lê/escreve nelas ainda; falta teste dedicado para `lib/automation/ingest.ts`; editor V1 não expõe `RANDOM_SPLIT`/`HTTP_REQUEST` na UI (engine já suporta os dois).

**Explicitamente CONGELADO** (código preservado, zero desenvolvimento novo até decisão explícita): Media Library (upload, storage, ffprobe, SHA-256, fingerprint perceptual, dedup), Google Drive, publicação, agendamento, calendário, scheduler, TikTok Publisher, qualquer feature estilo mLabs.
