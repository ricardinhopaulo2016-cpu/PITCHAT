# PITCHAT — Brand

> Direção: **SIGNAL DESK**. Ver `docs/PITCHAT_DESIGN_SYSTEM.md` pros tokens completos. North star visual: mockup aprovado pelo usuário em 10/09/2026 (fundo charcoal, saffron quente, símbolo P/balão, dashboard escuro compacto) — referência de sensação/contraste/composição, não um layout a copiar literalmente.

## 1. Conceito do símbolo

**P + balão de conversa**, leitura dupla: de longe é um ícone simples; de perto é um P integrado à forma de um balão de fala (a "cauda" do balão nasce da própria haste do P). Nunca: robô, cérebro, sparkles, estrela "AI", raio como símbolo principal, P genérico dentro de círculo, balão de fala 100% genérico, mascote.

Geometria: compacta, peso forte, poucas formas, funciona em 16×16 e em 512×512 sem perder legibilidade. Implementado em `components/icons/pitchat/pitchat-mark.tsx` (`PitchatMark`) — SVG puro, `currentColor`, sem gradient na versão master.

## 2. Sistema de logo

| Variante | Uso | Componente |
|---|---|---|
| Primary (símbolo + wordmark) | Login, telas de maior presença | `<PitchatMark />` + `<PitchatWordmark />` lado a lado |
| Symbol only | Sidebar, mobile, favicon, app icon | `<PitchatMark />` sozinho |
| Wordmark only | Contextos só-texto | `<PitchatWordmark />` |
| Monochrome | Qualquer fundo que não seja `--bg`/`--bg-sidebar` | `currentColor`, sem cor hardcoded |

A versão master funciona sem gradient — cor vem de `currentColor` (normalmente `var(--signal)` pro símbolo, `var(--text)` pro wordmark).

## 3. Wordmark

Parte da IBM Plex Sans (peso 600), não é texto solto: tracking levemente reduzido (`-0.01em`), caixa alta (`PITCHAT`). O símbolo é o elemento mais proprietário — o wordmark é deliberadamente mais "comum" pra não competir com ele.

## 4. Favicon / app icons

Gerados via `next/og` `ImageResponse` (nenhuma dependência nova, nenhuma rasterização manual) em `app/icon.tsx` (32×32) e `app/apple-icon.tsx` (180×180) — fundo `#0E0F0D` (near-black) + símbolo em `--signal`. Testado visualmente na malha de 16px: simplificado pra 2 formas (corpo do P + entalhe do balão), sem detalhe fino que suma em tamanho pequeno — legibilidade vence fidelidade, como pedido.

## 5. Uso do logo por contexto

- **Sidebar**: símbolo pequeno (18–20px) + wordmark, topo do `AppShell`.
- **Login**: símbolo com mais presença, ao lado de uma pequena rail conceitual (`mensagem → keyword → reply`) — nunca uma landing page dentro do login.
- **Mobile**: symbol-only quando o espaço for curto (topo do drawer).
- **Nunca**: logo girando como spinner, pulsando eternamente, brilhando, flutuando. Highlight permitido: ~120ms numa ação importante (ex: publish), nunca intro cinematográfica.

## 6. Iconografia proprietária — lógica de cada ícone

Todos em `components/icons/pitchat/`, SVG com `currentColor`, `viewBox` padronizado, stroke consistente com o símbolo (mesmo peso/raio de curva), 16–18px.

| Ícone | Conceito | Por que não o padrão de mercado |
|---|---|---|
| **OverviewIcon** | Uma rail vertical com sinais (pontos) em posições diferentes — visão geral dos sinais do sistema | Evita o grid 2×2 automático de "dashboard"; não parece gráfico financeiro |
| **FlowIcon** | `● │ ◆ │ ●` — trigger, lógica, ação | Automations **nunca** usa raio (⚡); esse símbolo nasce do próprio motor de automação do produto |
| **ChannelIcon** | Dois sinais conectados (`○─●`), pequena abertura remetendo a conversa | Social Accounts não usa o logo do Instagram como ícone de navegação — Instagram só aparece dentro da tela da conta |
| **InboxSignalIcon** | Uma thread entrando numa área receptora — representa recebimento | Não é só `MessageCircle`; comunica a direção (chegando), não só "existe uma caixa de mensagens" |
| **ContactThreadIcon** | Identidades ligadas por uma thread/conversa | Não é `UsersRound` genérico; a thread é o que conecta, coerente com o conceito central do produto |

`SignalMarker` (não é bem um "ícone de menu", é usado no editor/activity feed/logs): trigger `●`, lógica/keyword/condition `◆`, wait `||`, end `■`, error `!` — a repetição desses símbolos em todo lugar que mostra execução é o que constrói reconhecimento.

Lucide continua disponível só para ações universais (chevron, close, search, more, copy, trash, eye, lock, calendar, upload, download) — nunca para os 5 ícones acima.

## 7. Tom de voz

Ferramenta, não marketing. Direto, no particípio/presente do que aconteceu:

✅ "Conta conectada." · "Automação publicada." · "Comentário recebido." · "Mensagem enviada." · "Não foi possível enviar a resposta."
❌ "Oba! 🚀" · "Parabéns!" · "Eleve suas conversas!" · "Experiência potencializada por IA!"

Emoji só existe **dentro do conteúdo das automações** (mensagens que o usuário escreve pro Instagram) — nunca como ícone de sistema da UI.

## 8. Validação (repetir a cada mudança de logo/ícone)

1. Funciona em 32px? 2. Ainda reconhecível em 16px? 3. Funciona monochrome? 4. Ao lado de um SaaS genérico, ainda parece próprio? 5. Parece crypto/AI-generator/fintech/Discord-clone/chatbot genérico? Se sim em qualquer um, refinar antes de declarar pronto.
