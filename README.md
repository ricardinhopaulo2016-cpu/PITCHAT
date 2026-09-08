# PITCHAT

Automação de Instagram (comentário → private reply → DM com botões), Media Library
inteligente (deduplicação por hash + fingerprint perceptual) e Inbox — fonte de
verdade interna para substituir ManyChat + Drive nessa operação.

**Fora de escopo nesta versão**: agendamento/publicação de posts, calendário, scheduler.
Isso é uma fase futura — ver `docs/PITCHAT_ARCHITECTURE.md`.

## Documentação

- [`docs/PITCHAT_ARCHITECTURE.md`](docs/PITCHAT_ARCHITECTURE.md) — arquitetura, modelo de dados, roadmap.
- [`docs/PITCHAT_META_INTEGRATION.md`](docs/PITCHAT_META_INTEGRATION.md) — integração com a API do Instagram, incluindo o checklist manual pra criar o Meta App.
- [`supabase/README.md`](supabase/README.md) — setup do banco.

## Rodando localmente

```bash
npm install
cp .env.example .env.local   # preencha com os valores reais (ver docs acima)
npm run dev
```

Sem `.env.local` preenchido, a aplicação redireciona tudo para `/setup`.

## Scripts

```bash
npm run dev     # servidor de desenvolvimento
npm run build   # build de produção
npm run lint    # eslint
npm test        # vitest (roda uma vez)
```

## Stack

Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · Supabase (Postgres/Auth) ·
Upstash QStash (fila/delay) · Vercel.
