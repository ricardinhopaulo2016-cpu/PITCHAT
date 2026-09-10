# PITCHAT — Design System

> Nome da direção: **SIGNAL DESK**. Documento vivo — atualizar junto com `components/` e `app/globals.css` sempre que um token mudar. Ver também `docs/PITCHAT_BRAND.md` (logo/identidade) e `docs/PITCHAT_ARCHITECTURE.md` (arquitetura/backend — nada aqui muda backend).

## 1. Auditoria da UI anterior (09-10/09/2026)

Antes desta reforma, o PITCHAT usava o starter padrão do `create-next-app` sem nenhum token, sem `components/` compartilhado, tudo inline em cada `page.tsx`: `font-sans: system-ui`, preto/branco puro (`#ffffff`/`#0a0a0a`), Tailwind utilitário genérico (`rounded border p-4`, `text-sm opacity-60`), três `StatCard` idênticos no dashboard, listas em `<table>`/`<ul>` sem hierarquia visual proprietária, nenhum ícone, nenhum logo, favicon ausente. Não era "AI slop" decorado (não tinha gradient/glow/glass) — era ausência total de identidade, o problema oposto mas igualmente a resolver.

## 2. Conceito

O PITCHAT trabalha com **mensagens → sinais → gatilhos → decisões → ações → respostas**. A identidade nasce disso, não de um vocabulário de dashboard genérico. Cinco conceitos recorrentes:

| Conceito | Papel |
|---|---|
| **Signal** | evento detectado |
| **Rail** | caminho da automação |
| **Pulse** | evento acontecendo agora |
| **Stamp** | status confirmado |
| **Thread** | sequência de conversa |

Assinatura visual: **Logo + Saffron Signal + Signal Rail**. Mesmo uma tela só com fundo, texto, logo e uma rail já deve parecer PITCHAT.

## 3. Anti-AI slop — regras negativas

**Vício nº1 (SaaS-de-IA genérico) — nunca usar:** Inter/Roboto/Geist-porque-é-Next; gradient roxo/azul-roxo/cyan-roxo; glow; glassmorphism/backdrop-blur decorativo; três stat cards idênticos; bento grid sem necessidade; `rounded-xl`/pill em tudo; ícone Lucide (raio, sparkles, cérebro, robô, estrela) em cada título; `hover:scale`/bounce/shimmer infinito/fade-in em cascata; headline de landing page ("Transforme seu workflow", "O futuro da automação").

**Vício nº2 (anti-AI que virou outro clichê) — também nunca usar:** creme+terracota sem motivo; acid green só pra parecer diferente; falso brutalismo; falso editorial; ALL CAPS eyebrow em toda seção; mono font em tudo; setinhas decorativas; grain/noise gratuito.

**Regra geral**: nenhum elemento visual existe só pra provar criatividade. Antes de qualquer ícone: *"o usuário reconhece a função mais rápido com ele?"* — se não, não usa.

## 4. Paleta — dark-first, CSS variables

Não usar preto/branco puro em grandes superfícies. Distribuição: **85% neutros, 10% estrutura, 5% signal** — o amarelo nunca domina a tela; é marca/ação, não decoração. Verde = sucesso; não confundir os dois. Azul não é cor de identidade.

```css
--bg: #0E0F0D;
--bg-sidebar: #10110F;

--surface-1: #141512;
--surface-2: #191A17;
--surface-3: #1E201C;
--surface-elevated: #20221E;

--border-subtle: #262823;
--border: #32352E;
--border-strong: #484C42;

--text: #EEECE4;
--text-secondary: #B1B3AA;
--text-muted: #82867B; /* ajustado pra 4.9:1 contra surface-1 — contraste AA real (ver §12) */

/* Signal (marca/ação) */
--signal: #F2B441;
--signal-bright: #FFC14D;
--signal-hover: #FFC35C;
--signal-pressed: #D99A2B;
--signal-soft: rgba(242,180,65,.11);

/* Semânticas */
--success: #73B987;
--success-soft: rgba(115,185,135,.12);
--warning: #D9A957;
--warning-soft: rgba(217,169,87,.12);
--danger: #DD6B64;
--danger-soft: rgba(221,107,100,.12);
--info: #8DA8B7;
```

## 5. Tipografia

**IBM Plex Sans** (400/500/600) — nunca Inter. **IBM Plex Mono** só para conteúdo genuinamente técnico: IDs, timestamps, logs, payloads, keywords quando fizer sentido, metadados. Nunca mono só pra "parecer dev".

| Papel | Tamanho | Peso | Tracking |
|---|---|---|---|
| Page title | 30–34px | 600 | -0.025em |
| Section title | 17–19px | 600 | — |
| Body | 14–15px | 400 | — |
| Small | 12–13px | 400 | — |
| Micro técnico (mono) | 11–12px | 400 | — |

Poucos tamanhos, hierarquia clara — nunca uma escala tipográfica de 10 degraus.

## 6. Geometria

Nem tudo redondo. Borders importam mais que shadow; shadow só em elevação real (dropdown/popover/dialog/floating menu) — nunca em card parado na página.

| Elemento | Radius |
|---|---|
| Input | 5px |
| Button | 5px |
| Small panel | 6px |
| Large panel | 8px |
| Dialog/popover | 8px |

Pill **somente** para status, filtros compactos, categorias.

## 7. Spacing

Escala: `4 · 6 · 10 · 14 · 20 · 28 · 40 · 56`. Relacionado: 6–10. Grupo: 14–20. Seção: 28–40. Mudança grande: 56. Nunca `gap-4` em tudo — espaço em branco comunica hierarquia, não é sobra.

## 8. Motion

Tokens (`--motion-*`, `--ease-*`) — ver `app/globals.css`. CSS transitions primeiro, sem Framer Motion. Botão: 90–120ms, muda só background/border/color (nunca scale). Nav ativo: 140ms. Dropdown: 140–160ms opacity+translateY(-3px→0). Dialog: 180ms opacity+translateY(5px→0). Node add/remove no editor: 220ms/140ms. Toast: 180ms entrada/140ms saída. Atualização de dado real: `signal-soft` → transparente em ~600ms. Processamento real: pulse pequeno no status dot — nunca pulse decorativo sem evento real por trás.

`prefers-reduced-motion: reduce` é obrigatório: desliga translate/pulse/stagger, mantém só opacity curta e mudança de cor. Informação nunca depende só de animação.

## 9. Som

Três cues via Web Audio API simples (sem lib): `success` (duas notas curtas ascendentes), `error` (uma nota curta e grave), `live-event` (tick discreto). **Default OFF**, opt-in do usuário, preferência em `localStorage` (`lib/sound.ts`). Nunca toca em hover/nav/digitação/dropdown/autosave — só em eventos reais (publish, erro, evento ao vivo), com rate-limit contra rajada. Som nunca é o único feedback.

## 10. Sistema de ícones

Ver `docs/PITCHAT_BRAND.md` §Ícones para a lógica de cada ícone proprietário. Regra: Lucide é ferramenta secundária pra ações universais (chevron, close, search, more, copy, trash, eye, lock, calendar, upload, download) — nunca pra identidade dos conceitos centrais (Dashboard, Automations, Social Accounts, Inbox, Contacts). Estado normal: `text-muted`. Hover: `text-secondary`. Ativo: `text`/`signal` + Signal Rail de 2px — nunca glow/círculo neon/gradient.

**Signal markers** (usados no editor, activity feed, logs, status): trigger `●`, lógica/keyword/condition `◆`, wait `||`, end `■`, error `!`.

## 11. Componentes

`components/icons/pitchat/` (PitchatMark, OverviewIcon, FlowIcon, ChannelIcon, InboxSignalIcon, ContactThreadIcon, SignalMarker) · `components/ui/` (Button, Input, Textarea, Select, StatusIndicator, EmptyState, Toast) · `components/app-shell/` (AppShell, Sidebar, MobileSidebar, PageHeader) · `components/automations/` (AutomationRegistry, AutomationRow) · `components/dashboard/` (StatStrip, ActivityRail).

## 12. Acessibilidade

Navegação por teclado, foco visível, `aria-label` em ícone-só-button, contraste AA, status nunca depende só de cor (sempre símbolo + texto), `prefers-reduced-motion` respeitado, Radix para dialog/menu.

## 13. Regra de ouro

**PITCHAT não usa o raio (⚡) clássico para representar automação.** O símbolo nasce do próprio fluxo: `● │ ◆ │ ●` — trigger, lógica, ação. Essa sequência é a propriedade visual mais reconhecível do produto.
