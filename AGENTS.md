<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# PITCHAT — regras do projeto

- Escopo desta fase: automação de Instagram (ManyChat interno), Media Library, Inbox.
  **NÃO implementar** agendamento/publicação/calendário/scheduler — ver `docs/PITCHAT_ARCHITECTURE.md`.
- Nunca hardcode nome de perfil (ex: "Papagaio") em código — é dado em `profiles.name`.
- Nunca use filename como identidade de mídia — `media_assets` usa SHA-256 + fingerprint.
- Toda tabela de domínio carrega `workspace_id`; toda rota server-side usa `service_role`
  e por isso PRECISA validar `workspace_id` manualmente (RLS é defesa em profundidade, não a única barreira).
- Webhook da Meta nunca processa automação dentro da própria request — persiste em
  `webhook_events` e enfileira via QStash.
- Não invente comportamento de API da Meta — consulte `docs/PITCHAT_META_INTEGRATION.md`
  e, se algo não estiver lá, a documentação oficial antes de codificar.
- Antes de declarar teste/build aprovado, rode de fato (`npm test`, `npm run build`) e cole o resultado.
