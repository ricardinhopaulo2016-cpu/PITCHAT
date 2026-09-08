# PITCHAT — Arquitetura

> Documento vivo. Atualizar a cada fase concluída (ver seção 12, Roadmap).

## 1. Visão

PITCHAT é a plataforma interna para centralizar automação de Instagram (estilo ManyChat, só com o que a operação realmente usa), Media Library inteligente e Inbox — com arquitetura pronta para, no futuro, ganhar publicação/agendamento sem reescrita.

**Fora de escopo nesta fase (V1)**: agendamento de publicação, calendário de posts, publicação automática, Content Publishing API, scheduler. Isso fica para uma fase futura; não existe código morto/placeholder para isso no V1.

## 2. Stack (decidida com o usuário em 08/09/2026)

| Camada | Escolha | Motivo |
|---|---|---|
| Framework | Next.js 16.2.9 (App Router), React 19.2, TypeScript | Consistência com o PitBrain (projeto irmão) |
| Estilo | Tailwind CSS v4 + shadcn/radix | Idem |
| Banco/Auth/Storage | Supabase — **projeto próprio e isolado**, não compartilha nada com o PitBrain | Isolamento de dados explicitamente pedido pelo usuário |
| Hospedagem | Vercel (serverless) | Consistência; barato; mas ver limitação de execução longa abaixo |
| Fila / Delay / Retry | **Upstash QStash** | Vercel é serverless — não segura `setTimeout` de minutos. QStash é fila HTTP gerenciada com delay e retry nativos, sem precisar manter um worker sempre ligado |
| Testes | Vitest | Leve, roda bem em TS/ESM sem config extra |

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

## 8. Media Library — identidade sem depender de filename

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
| App Review + Business Verification da Meta pode ser exigido antes de gerenciar contas de terceiros | Bloqueia onboarding de clientes externos | Validar com Standard Access + contas próprias primeiro; migrar pra Advanced Access quando necessário |
| Meta App ainda não existe | Bloqueia toda a Fase 4+ (OAuth/webhooks reais) | Checklist de criação em `PITCHAT_META_INTEGRATION.md`, ação manual do usuário |
| Projeto Supabase do PITCHAT ainda não existe | Bloqueia toda persistência real | Usuário precisa criar em supabase.com e preencher `.env.local` |
| Conta Upstash/QStash ainda não existe | Bloqueia delays/filas reais | Usuário precisa criar conta e preencher `.env.local` |
| Fingerprint perceptual de vídeo é uma área com muita variação de qualidade | Falsos positivos/negativos de duplicata | V1 usa heurística documentada e substituível (score exposto na UI, decisão humana persistida) |

## 12. Roadmap (ordem de implementação — não pular fase quebrada)

- [x] **Fase 0** — Auditoria + pesquisa oficial + este documento
- [~] **Fase 1** — Fundação: workspace, profiles, auth, banco, permissões *(em andamento — ver relatório de fase)*
- [ ] Fase 2 — Media Library: upload, storage, ffprobe, SHA-256, duplicata exata
- [ ] Fase 3 — Fingerprint perceptual
- [ ] Fase 4 — Conexão Instagram (OAuth)
- [ ] Fase 5 — Webhooks / comentários / contatos
- [ ] Fase 6 — Motor de automação mínimo (trigger → keyword → public reply → private reply → send message → end)
- [ ] Fase 7 — automation_runs + logs
- [ ] Fase 8 — Botões / quick replies
- [ ] Fase 9 — Delay / conditions / tags / custom fields
- [ ] Fase 10 — Inbox + human takeover
- [ ] Fase 11 — HTTP request node / random split
- [ ] Fase 12 — Polish / testes / segurança

**Explicitamente fora do roadmap desta versão**: publicação, agendamento, calendário, scheduler, TikTok Publisher.
