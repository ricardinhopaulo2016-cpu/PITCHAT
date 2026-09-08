# PITCHAT — Integração Meta (Instagram)

Levantamento feito em cima da documentação oficial `developers.facebook.com` (setembro/2026). Onde a doc não é literal/explícita, está marcado como **não documentado claramente** — não inventamos comportamento.

## 1. Checklist manual — criar o Meta App (você precisa fazer isso; eu não consigo)

1. Acesse https://developers.facebook.com/apps e crie um App do tipo **Business**.
2. No App Dashboard, adicione o produto **Instagram** (não "Facebook Login" isoladamente) — fluxo escolhido: **Instagram API with Instagram Login** (não exige Página do Facebook vinculada).
3. Em **Instagram → API setup with Instagram login**, conecte a conta profissional do Instagram que vai ser gerenciada primeiro (ex: uma das contas que vocês já operam) como conta de teste.
4. Gere/anote:
   - `META_APP_ID`
   - `META_APP_SECRET`
   - `META_REDIRECT_URI` (a URL de callback OAuth do PITCHAT, ex: `https://<seu-domínio>/api/auth/meta/callback`)
5. Configure o **Webhook** do produto Instagram apontando pra `https://<seu-domínio>/api/webhooks/meta`, com:
   - `META_WEBHOOK_VERIFY_TOKEN` (você escolhe uma string aleatória e usa a mesma no `.env`)
   - Assine os campos (`subscribed_fields`): no mínimo `comments`, `messages`, `messaging_postbacks`.
6. Solicite as permissões (escopo "Standard Access" primeiro, contas que vocês mesmos possuem — não exige App Review):
   - `instagram_business_basic`
   - `instagram_business_manage_messages`
   - `instagram_business_manage_comments`
7. **Só quando for gerenciar conta de cliente que vocês não possuem**: será necessário migrar pra **Advanced Access**, o que exige **App Review** + **Business Verification** (documento oficial confirma que Advanced Access exige as duas coisas juntas — a ligação literal entre isso e a permission `instagram_business_manage_messages` especificamente não foi encontrada verbatim numa única página, tratar como bloqueio a validar na prática antes de prometer prazo pro cliente).
8. Preencha o `.env.local` do PITCHAT com os valores gerados (ver `.env.example`).

## 2. Fluxo de autenticação

**Escolhido: Instagram API with Instagram Login.**
Fonte: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/

Alternativa existente (não escolhida): "Instagram API with Facebook Login", que exige Página do Facebook vinculada à conta profissional e usa outro conjunto de permissões (`instagram_basic`, `instagram_manage_messages`, etc). Preferência oficial da Meta entre as duas para apps novos: **não documentada claramente** — a doc só descreve critérios de quando usar cada uma.

## 3. Webhooks

- Verificação inicial: `GET` no endpoint configurado, com `hub.mode=subscribe`, `hub.challenge` (ecoar de volta) e `hub.verify_token` (comparar com o nosso `META_WEBHOOK_VERIFY_TOKEN`).
- Assinatura: header `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(payload bruto, `META_APP_SECRET`). A doc trata como recomendado, mas **no PITCHAT é obrigatório rejeitar payload sem assinatura válida**.
- Topics relevantes pro V1: `comments`, `messages`, `messaging_postbacks` (clique em quick reply/botão). Habilitar via `POST /me/subscribed_apps?subscribed_fields=...`.
- Fontes: https://developers.facebook.com/docs/instagram-platform/webhooks , https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram

⚠️ Não conseguimos copiar um payload de exemplo 100% literal via fetch automatizado (a ferramenta resume a página em vez de devolver o HTML bruto). **Antes de escrever o parser do webhook, abrir a página de referência no navegador e copiar o JSON de exemplo exato.**

## 4. Private Reply (resposta privada a comentário)

`POST /<IG_ID>/messages` com:
```json
{"recipient": {"comment_id": "<COMMENT_ID>"}, "message": {"text": "<texto>"}}
```

Regras confirmadas na doc oficial:
- Janela de **7 dias** após o comentário (posts/reels). Em Lives, só durante a transmissão.
- **Uma única private reply por comentário, para sempre** — segunda tentativa deve falhar de forma explícita no nosso sistema, nunca silenciar.
- Depois da private reply, seguir enviando só é possível se o usuário responder (aí vale a janela de 24h padrão).
- Rate limit: 750 chamadas/hora (post/reel) por conta profissional; 100/s em Live.

Fontes: https://developers.facebook.com/documentation/instagram-platform/private-replies , https://developers.facebook.com/docs/instagram-platform/private-replies/

## 5. Send API (mensagens diretas)

`POST https://graph.instagram.com/v<VERSAO>/<IG_ID>/messages`

Texto:
```json
{"recipient": {"id": "<IGSID>"}, "message": {"text": "<até 1000 bytes>"}}
```

Quick Replies (máx. 13 opções, título até 20 caracteres):
```json
{"recipient": {"id": "<IGSID>"}, "message": {"text": "<pergunta>", "quick_replies": [{"content_type": "text", "title": "<botão>", "payload": "<payload>"}]}}
```

Generic Template (máx. 10 elementos, máx. 3 botões/elemento, só botões `web_url`/`postback`):
```json
{"recipient": {"id": "<IGSID>"}, "message": {"attachment": {"type": "template", "payload": {"template_type": "generic", "elements": [{"title": "...", "subtitle": "...", "image_url": "...", "buttons": [{"type": "postback", "title": "...", "payload": "..."}]}]}}}}
```

`IGSID` (Instagram-Scoped ID) chega via webhook quando o usuário comenta ou manda mensagem — é o que vai em `recipient.id`.

Fontes: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api/quick-replies , .../generic-template , .../messaging-api

## 6. Janela de mensagens (messaging window)

A doc da Messaging API do Instagram Login confirma explicitamente: **24 horas** para responder a partir da última mensagem do usuário — mesma lógica do Messenger.

**Human Agent tag**: permite um humano (nunca automação) responder fora da janela de 24h, até 7 dias desde a última mensagem do usuário. Proibido usar pra conteúdo promocional. Uso indevido pode restringir a capacidade de envio da conta.

**Não documentado claramente**: lista exaustiva de quais outras message tags (além de Human Agent) valem para Instagram (vs. só Messenger). Recursos como One-Time Notification, News Messaging e Sponsored Messages são **explicitamente indisponíveis** na IG Messaging API.

Fontes: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/messaging-api , https://developers.facebook.com/documentation/business-messaging/messenger-platform/policy

## 7. Rate limits

- Graph API geral: `chamadas em 24h = 4800 × impressões da conta em 24h`.
- Conversations API: 2 req/s.
- Private Replies: 750/h (post/reel), 100/s (live).
- Send API: 100 req/s (texto/link/reação/figurinha), 10 req/s (áudio/vídeo).

Fontes: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ , https://developers.facebook.com/documentation/instagram-platform/private-replies

## 8. App Review / Business Verification

**Standard Access** (contas que o próprio desenvolvedor/workspace possui e adicionou no App Dashboard): não exige App Review. Suficiente pra Fase 4-9 usando as contas que vocês mesmos operam (Papagaio, Dodo, etc).

**Advanced Access** (contas de terceiros/clientes): exige App Review **e** Business Verification. Necessário antes de o PITCHAT atender qualquer cliente externo.

Fonte: https://developers.facebook.com/docs/instagram-platform/app-review/

## 9. Checklist de variáveis de ambiente (Meta)

```
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=
META_WEBHOOK_VERIFY_TOKEN=
META_API_VERSION=v25.0
```

Nunca commitar valores reais. Nunca colocar placeholder "funcionando" silenciosamente — se algum fluxo depender dessas variáveis e elas não existirem, a rota deve retornar erro explícito (`META_NOT_CONFIGURED`), não simular sucesso.

## 10. Confiabilidade desta pesquisa

Esta pesquisa foi feita via busca + fetch automatizado (que resume páginas em vez de devolver HTML bruto em alguns casos). Para os pontos mais sensíveis — payload exato de webhook, texto legal completo de política de mensagens — o recomendado é reabrir as URLs citadas manualmente (ou eu abrir via browser real) antes de codificar o parser, para não basear parsing em texto resumido por um modelo intermediário.
