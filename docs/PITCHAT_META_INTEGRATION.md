# PITCHAT — Integração Meta (Instagram)

Levantamento feito em cima da documentação oficial `developers.facebook.com` (setembro/2026, revalidado em 09/09/2026 após mudança de escopo do projeto para foco 100% em automação estilo ManyChat). Onde a doc não é literal/explícita, está marcado como **não documentado claramente** — não inventamos comportamento. Cada afirmação carrega a URL fonte.

## 0. Status de verificação — IMPLEMENTED ≠ PROVADO

Existe código e testes (com mocks) para os quatro fluxos abaixo, mas **nenhum rodou contra a API real da Meta ainda** — só passam a ser considerados funcionando de verdade depois de um teste ponta a ponta com Instagram real (ver `docs/PITCHAT_ARCHITECTURE.md` §13, "Teste ponta a ponta real"). Até lá, o status correto é `IMPLEMENTED / NOT E2E VERIFIED`, nunca "funcionando":

| Componente | Código | Status |
|---|---|---|
| OAuth (`lib/meta/oauth.ts`, `app/api/auth/meta/*`) | Completo | `IMPLEMENTED / NOT E2E VERIFIED` |
| Webhook (`app/api/webhooks/meta/route.ts`, `lib/meta/events.ts`) | Completo | `IMPLEMENTED / NOT E2E VERIFIED` |
| Private Reply (`lib/meta/client.ts::sendPrivateReply`) | Completo | `IMPLEMENTED / NOT E2E VERIFIED` |
| Send API — texto/quick reply (`lib/meta/client.ts::sendTextMessage/sendQuickReplies`) | Completo | `IMPLEMENTED / NOT E2E VERIFIED` |

Atualizar esta tabela pra `E2E VERIFIED (dd/mm/aaaa)` só depois de uma chamada real bem-sucedida, com o `messageId`/status HTTP retornado pela Meta anexado ao relatório de fase.

## 1. Checklist manual — criar o Meta App (você precisa fazer isso; eu não consigo)

⚠️ **Aviso de precisão**: os nomes de produto/permission abaixo vêm de texto literal de páginas oficiais (URL citada em cada item). Os **nomes exatos de botão/menu dentro do App Dashboard** (que é uma SPA renderizada em JS) não puderam ser extraídos por fetch automatizado em alguns pontos — nesses casos, sigo o assistente/wizard que a própria Meta mostra dentro do produto (ele se adapta à versão atual da UI e é mais confiável que qualquer captura estática, inclusive a minha). Marquei `[wizard]` nesses passos.

O PITCHAT terá **Meta App próprio** — não reutilizar app de outro projeto (PitBrain ou qualquer outro).

1. Acesse https://developers.facebook.com/apps → **Create App** → tipo **Business**.
   Fonte (tipo de app): https://developers.facebook.com/docs/development/create-an-app/
2. No App Dashboard, **Add Product** → **Instagram**. `[wizard]` O produto abre um assistente guiado próprio chamado **"API setup with Instagram login"** — siga os passos numerados que ele mostrar (a Meta atualiza essa tela sem aviso; qualquer captura de tela externa pode já estar desatualizada). O breadcrumb confirmado na doc oficial é:
   **App Dashboard → Instagram → API setup with Instagram login → 3. Set up Instagram business login → Business login settings**
   Fonte: https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
3. Dentro de **Business login settings** (passo 2 acima): adicione a(s) **OAuth redirect URI(s)**: `https://<seu-domínio>/api/auth/meta/callback` (precisa casar caractere-a-caractere com `META_REDIRECT_URI`). Em dev local, use a URL pública de um túnel (ngrok/Cloudflare Tunnel/similar) — a Meta não aceita `localhost`.
4. `[wizard]` No mesmo assistente, há um passo pra **conectar/gerar token de uma conta Instagram** — use aí a sua conta profissional (Business ou Creator) de teste. Essa é a conta que vai validar o fluxo ponta a ponta antes de qualquer cliente real.
5. Anote em **App Dashboard → App settings → Basic** (esse caminho é estável, não faz parte do wizard do produto):
   - `META_APP_ID` (App ID)
   - `META_APP_SECRET` (App Secret)
6. Configure o **Webhook** do produto Instagram (dentro do mesmo assistente "API setup with Instagram login", seção de Webhooks, ou em **App Dashboard → Webhooks → Instagram**):
   - **Callback URL**: `https://<seu-domínio>/api/webhooks/meta`
   - **Verify token**: você escolhe uma string aleatória própria → vai em `META_WEBHOOK_VERIFY_TOKEN` no `.env` (precisa ser idêntica dos dois lados — o `GET` do nosso endpoint já valida isso, ver §3)
   - **Subscribed fields** mínimos para o MVP: `comments`, `messages`, `messaging_postbacks`. `message_reactions` é opcional no V1.
7. Solicite as **permissions** (nomes confirmados em duas páginas oficiais distintas — os nomes antigos sem `_business_` foram descontinuados em 27/01/2025; **confirme o texto exato mostrado na tela do seu App Dashboard antes de copiar pro `.env`**, porque uma terceira fonte consultada grafou uma delas de forma ligeiramente diferente — ver ressalva abaixo):
   - `instagram_business_basic`
   - `instagram_business_manage_messages`
   - `instagram_business_manage_comments`
   - (`instagram_business_content_publish` só seria necessária se reativarmos publicação no futuro — **não solicitar agora**, escopo congelado)
   Fontes: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/ , https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login
8. **Modo Development (antes de qualquer App Review)** — confirmado em https://developers.facebook.com/docs/development/build-and-test/app-modes/:
   - Só usuários com **Role no app** (Administrator, Developer ou Tester — adicionados em **App Dashboard → App roles**) conseguem usar o app nesse modo.
   - Citação literal: *"Apps in Development mode cannot be searched for by the public through our tools and APIs"* — isso não afeta o PITCHAT (não dependemos de listagem pública).
   - Nesse modo, as 3 permissions acima **já funcionam sem App Review**, desde que a conta Instagram conectada pertença a alguém com Role no app (ou ao Business Portfolio dono do app) — é exatamente o caso da conta de teste do passo 4. Suficiente pra todo o MVP e pro teste E2E.
9. **Só quando for gerenciar conta de cliente que vocês não possuem** (modelo Tech Provider/SaaS multi-tenant — caso do PITCHAT no médio prazo): será necessário sair do modo Development (ir a **Live**) com **Advanced Access**, que exige **App Review + Business Verification** juntos (App Dashboard → seção "Business verification"). Processo de review pede: ícone do app 1024×1024, política de privacidade, categoria, email de negócio, e pra cada permission um screencast demonstrando o uso real na UI. **Não é necessário pra nenhum passo do teste E2E com sua própria conta.**
10. Preencha o `.env.local` do PITCHAT com os valores gerados (ver §9 deste doc e `.env.example`).

**Nada do desenvolvimento abaixo depende de você ter terminado esse checklist** — o código já foi implementado e será mantido evoluindo; só o *teste contra API real* fica bloqueado até o Meta App existir.

### Requisito de Página do Facebook — confirmação

O produto **"Instagram API with Instagram Login"** (o escolhido) não exige Página do Facebook vinculada — é justamente a diferença dele pro produto legado "Instagram API with Facebook Login". As duas tentativas de fetch automatizado na doc de criação de app não retornaram o texto completo (página é renderizada via JS pesado); a ausência de qualquer menção a "Facebook Page" nas páginas de referência do produto (`instagram-api-with-instagram-login`, `business-login`) que **foram** lidas com sucesso é consistente com essa premissa, mas não é uma confirmação literal 100% explícita numa frase única. Se o wizard do App Dashboard pedir uma Página em algum ponto, é sinal de que a Meta mudou esse requisito — nesse caso, pare e me avise antes de prosseguir, não presuma.

## 2. Fluxo de autenticação

**Escolhido: Instagram API with Instagram Login** (Business Login for Instagram).
Fonte: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/ , https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-instagram-login/business-login

Alternativa existente (não escolhida): "Instagram API with Facebook Login" — exige Página do Facebook vinculada à conta profissional, outro conjunto de permissões (`instagram_basic`, `instagram_manage_messages`, etc). Preferência oficial da Meta entre as duas para apps novos: **não documentada claramente** — a doc só descreve critérios de quando cada uma se aplica.

### Endpoints e sequência OAuth

| Passo | Endpoint | Notas |
|---|---|---|
| 1. Autorização (browser) | `GET https://www.instagram.com/oauth/authorize?client_id=&redirect_uri=&response_type=code&scope=` | `redirect_uri` idêntica à cadastrada; `scope` = lista separada por vírgula das 3 permissions |
| 2. Troca code → short-lived token | `POST https://api.instagram.com/oauth/access_token` (`client_id`, `client_secret`, `grant_type=authorization_code`, `redirect_uri`, `code`) | `code` da URL de callback vale **1h, uso único** |
| 3. Exchange → long-lived token | `GET https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=&access_token=` | short-lived expira em **3600s (1h)**; long-lived expira em **5.184.000s (60 dias)** |
| 4. Refresh do long-lived | `GET https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=` | só funciona se o token tiver **≥24h de idade** e **ainda não estiver expirado**; renovado vale outros 60 dias |

Fontes: https://developers.facebook.com/docs/instagram-platform/reference/access_token/ , https://developers.facebook.com/docs/instagram-platform/reference/refresh_access_token/

**Não documentado claramente**: comportamento exato se o long-lived token expirar sem refresh a tempo (grace period vs. exigir OAuth completo de novo). Tratar como "exige reconexão manual" até validarmos na prática — `social_accounts.status = 'expired'` já modela isso.

Todas as trocas usam `client_secret` → **server-side only**, nunca em código client-side. Já implementado assim em `lib/meta/oauth.ts`.

## 3. Webhooks

- **Verificação inicial**: `GET` no endpoint configurado, com `hub.mode=subscribe`, `hub.challenge` (ecoar de volta) e `hub.verify_token` (comparar com `META_WEBHOOK_VERIFY_TOKEN`). Já implementado em `app/api/webhooks/meta/route.ts` (`GET`).
- **Assinatura**: header `X-Hub-Signature-256` = `sha256=` + HMAC-SHA256(payload bruto, `META_APP_SECRET`). No PITCHAT é **obrigatório** rejeitar payload sem assinatura válida (já implementado, `lib/meta/signature.ts`).
- **Subscribe via API** (alternativa a configurar manualmente no dashboard): `POST /me/subscribed_apps?subscribed_fields=comments,messages,messaging_postbacks&access_token=<token da conta>`.
- **Fields disponíveis** (Instagram): `comments`, `live_comments`, `mentions`, `messages`, `message_echoes`, `message_edit`, `message_reactions`, `messaging_handover`, `messaging_optins`, `messaging_policy_enforcement`, `messaging_postbacks`, `messaging_referral`, `messaging_seen`, `response_feedback`, `standby`, `story_insights`. **V1 usa**: `comments`, `messages`, `messaging_postbacks` (`message_reactions` opcional).

Fontes: https://developers.facebook.com/docs/instagram-platform/webhooks , https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram

### Payloads confirmados (envelope padrão Graph API: `{object:"instagram", entry:[{id, time, changes:[{field, value}]}]}`)

**Comentário** (`field: "comments"`):
```json
{
  "field": "comments",
  "value": {
    "from": { "id": "<IGSID numérico>", "username": "<username>" },
    "media": { "id": "<media id>", "media_product_type": "<tipo>" },
    "id": "<comment id>",
    "parent_id": "<parent comment id, se for reply>",
    "text": "<texto do comentário>"
  }
}
```

**Mensagem recebida** (`field: "messages"`):
```json
{
  "field": "messages",
  "value": {
    "sender": { "id": "<IGSID>" },
    "recipient": { "id": "<IG account id>" },
    "timestamp": 1234567890,
    "message": { "mid": "<message id>", "text": "<texto>", "quick_reply": { "payload": "<payload>" } }
  }
}
```
(`message.quick_reply` só aparece quando o usuário tocou num botão de quick reply.)

**Postback** (clique em botão `postback` de template) (`field: "messaging_postbacks"`):
```json
{
  "field": "messaging_postbacks",
  "value": {
    "sender": { "id": "<IGSID>" },
    "recipient": { "id": "<IG account id>" },
    "timestamp": 1234567890,
    "postback": { "title": "<label do botão>", "payload": "<payload definido por nós>" }
  }
}
```

**Reação a mensagem** (`field: "message_reactions"`) — ⚠️ estrutura reconstruída de texto descritivo da doc, **não** de um JSON de exemplo literal. Tratar como aproximada, logar payload bruto e ajustar o parser após o primeiro evento real de teste:
```json
{
  "field": "message_reactions",
  "value": {
    "sender": { "id": "<IGSID>" },
    "recipient": { "id": "<IG account id>" },
    "timestamp": 1234567890,
    "reaction": { "mid": "<id da mensagem reagida>", "action": "react | unreact", "reaction": "love", "emoji": "❤️" }
  }
}
```

Fonte de todos os payloads acima: https://developers.facebook.com/docs/graph-api/webhooks/reference/instagram

**Buscar detalhes de um comentário via Graph API** (se o payload do webhook não bastar): `GET https://graph.instagram.com/v25.0/<IG_COMMENT_ID>?fields=id,text,username,timestamp,like_count,media,parent_id,hidden,from&access_token=<token>`.
Fonte: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-comment/

## 4. Private Reply (resposta privada a comentário)

`POST https://graph.instagram.com/v<VERSAO>/<IG_ID>/messages`:
```json
{ "recipient": { "comment_id": "<COMMENT_ID>" }, "message": { "text": "<texto>" } }
```

Regras confirmadas na doc oficial:
- Janela de **7 dias** após o comentário (posts/reels/story replies). Em **Instagram Live**, só durante a transmissão.
- **Uma única private reply por comentário, para sempre** — segunda tentativa deve falhar de forma explícita no nosso sistema (`error.code = "META_PRIVATE_REPLY_ALREADY_SENT"`), nunca silenciar. Já modelado assim na arquitetura.
- Depois da private reply, continuar mandando mensagens só é possível se o usuário responder (aí vale a janela de 24h padrão do Send API).
- Rate limit: **750 chamadas/hora** por conta profissional (post/reel); **100/s** em Live.

Fonte: https://developers.facebook.com/docs/instagram-platform/private-replies/

## 5. Send API (mensagens diretas)

`POST https://graph.instagram.com/v25.0/<IG_ID>/messages`

**Texto** (até 1000 bytes UTF-8):
```json
{ "recipient": { "id": "<IGSID>" }, "message": { "text": "<texto>" } }
```

**Quick Replies** (máx. 13 opções, título até 20 caracteres — trunca se maior; `content_type` pode ser `text`, `user_phone_number`, `user_email`; não funciona em desktop, só mobile/app):
```json
{
  "recipient": { "id": "<IGSID>" },
  "message": {
    "text": "<pergunta>",
    "quick_replies": [
      { "content_type": "text", "title": "<botão>", "payload": "<payload>" }
    ]
  }
}
```
Ao tocar, chega webhook `messages` com `message.quick_reply.payload` + `message.text` = título escolhido.

**Button Template** (texto até 640 caracteres + até 3 botões, tipos `web_url` ou `postback`):
```json
{
  "recipient": { "id": "<IGSID>" },
  "message": {
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "button",
        "text": "<texto>",
        "buttons": [
          { "type": "web_url", "url": "<URL>", "title": "<label>" },
          { "type": "postback", "payload": "<string>", "title": "<label>" }
        ]
      }
    }
  }
}
```

**Generic Template** (carrossel, máx. 10 elementos, máx. 3 botões/elemento, só `web_url`/`postback`):
```json
{
  "recipient": { "id": "<IGSID>" },
  "message": {
    "attachment": {
      "type": "template",
      "payload": {
        "template_type": "generic",
        "elements": [
          {
            "title": "<até 80 chars>",
            "subtitle": "<até 80 chars, opcional>",
            "image_url": "<https://...>",
            "buttons": [ { "type": "postback", "title": "<label>", "payload": "<payload>" } ]
          }
        ]
      }
    }
  }
}
```

`IGSID` (Instagram-Scoped ID) chega via webhook quando o usuário comenta ou manda mensagem — é o que vai em `recipient.id`.

Fontes: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/ , .../quick-replies/ , .../button-template/ , .../generic-template/

## 6. Janela de mensagens (messaging window)

A doc da Messaging API do Instagram Login confirma: **24 horas** para responder a partir da última mensagem do usuário — mesma lógica do Messenger. Fora disso, `SEND_MESSAGE` deve falhar explicitamente (`META_OUTSIDE_MESSAGING_WINDOW`), nunca simular envio.

**Human Agent tag**: permite um **humano real** (nunca automação) responder fora da janela de 24h, por até **7 dias** desde a última mensagem do usuário. **Proibido** usar para conteúdo promocional. **Proibido** a automação aplicar essa tag sozinha — uso indevido pode restringir a capacidade de envio da conta.

**Não documentado claramente**: lista exaustiva de quais outras message tags (além de Human Agent) valem para Instagram. One-Time Notification, News Messaging e Sponsored Messages são **explicitamente indisponíveis** na IG Messaging API — não implementar.

Fontes: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api/

## 7. Rate limits

| Escopo | Limite |
|---|---|
| Graph API geral (Platform Rate Limit) | `chamadas/24h = 4800 × impressões da conta nas últimas 24h`; monitorar via header `X-App-Usage` |
| Conversations API (leitura de conversas) | 2 req/s por conta |
| Private Reply — posts/reels | 750 chamadas/hora por conta |
| Private Reply — Live | 100 chamadas/s por conta |
| Send API — texto/link/reação/sticker | 100 req/s por conta |
| Send API — áudio/vídeo | 10 req/s por conta |

Ao atingir 100% de qualquer métrica, chamadas passam a falhar (Instagram usa código de erro específico **80002**). Classificar como `retryable` com backoff — nunca fazer loop agressivo.

Fontes: https://developers.facebook.com/docs/graph-api/overview/rate-limiting/ , https://developers.facebook.com/docs/instagram-platform/private-replies/

## 8. App Review / Business Verification

**Standard Access** (contas que o próprio desenvolvedor/workspace possui, com Role no app ou no Business Portfolio que reivindicou o app): **não exige App Review**. Suficiente para todo o MVP com contas próprias (Papagaio, Dodo, etc. — nome sempre vem de `profiles.name`, nunca hardcode).

**Advanced Access** (app atende contas profissionais de terceiros que não têm Role no app — modelo "Tech Provider", que é o caso do PITCHAT como SaaS multi-tenant no médio prazo): exige **App Review E Business Verification** juntos. Necessário antes de o PITCHAT atender qualquer cliente externo.

**Não documentado claramente**: tabela granular de qual permission isoladamente exige Advanced Access — a regra oficial é por modelo de uso (Tech Provider atendendo terceiros = as 4 permissions de messaging/comments/publish exigem Advanced Access nesse modelo), não uma lista permission-a-permission.

Fontes: https://developers.facebook.com/docs/instagram-platform/app-review/ , https://developers.facebook.com/documentation/instagram-platform/app-review , https://developers.facebook.com/docs/instagram-platform/create-an-instagram-app/

## 9. Checklist de variáveis de ambiente (Meta)

```
META_APP_ID=
META_APP_SECRET=
META_REDIRECT_URI=
META_WEBHOOK_VERIFY_TOKEN=
META_API_VERSION=v25.0
META_TOKEN_ENCRYPTION_KEY=
```

Nunca commitar valores reais. Nunca colocar placeholder "funcionando" silenciosamente — se algum fluxo depender dessas variáveis e elas não existirem, a rota deve retornar erro explícito (`META_NOT_CONFIGURED`), não simular sucesso. Já implementado assim.

## 10. Confiabilidade desta pesquisa

Revalidada em 09/09/2026 com fetch direto das páginas oficiais (não apenas resumo de busca) — os payloads de webhook (comentário, mensagem, postback) e os endpoints de token agora têm confirmação textual literal com URL. Pontos que continuam como ressalva, listados explicitamente onde aparecem acima:

1. Estrutura exata do campo `reaction` em `message_reactions` (não veio como JSON de exemplo literal).
2. Comportamento exato pós-expiração do long-lived token.
3. Granularidade exata de quais permissions isoladas exigem Advanced Access (a regra documentada é por modelo de uso, não por permission).

Nenhum desses três pontos bloqueia o desenvolvimento do MVP — apenas exigem validação empírica (evento real de teste) antes de tratar o comportamento como definitivo.
