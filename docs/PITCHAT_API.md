# PITCHAT — API de ingestão

Sobe e agenda Reels e Stories sem o navegador. Criada em 10/11/2026.

## Autenticação

`Authorization: Bearer pct_...`. O token é gerado em **Contas > Acesso pela API** e aparece uma vez só; o banco guarda apenas o SHA-256 (`api_tokens.token_hash`). Revogar preenche `revoked_at`. Um token vale para o workspace de quem o gerou e nunca cria outro token. Header `Authorization` presente e inválido responde 401, sem cair para a sessão do navegador.

As mesmas rotas aceitam a sessão do navegador quando não há header.

## Fluxo

1. `POST /api/media/upload-url` `{ filename, fileSize }` → `{ mediaAssetId, storageKey, token }`.
2. Envia os bytes ao Storage com `uploadToSignedUrl(storageKey, token, arquivo)` (supabase-js, chave publicável). Limite real: 50 MB por arquivo no plano gratuito do Supabase.
3. `POST /api/media/finalize` `{ mediaAssetId }` → `READY` (id da mídia) ou `EXACT_DUPLICATE` (`existingAssetId`: o mesmo vídeo já existe e é reaproveitado).
4. `POST /api/scheduled-posts/batch` com `dryRun: true` → revisão, nada é gravado.
5. O mesmo corpo sem `dryRun` → agenda.

## `POST /api/scheduled-posts/batch`

```json
{
  "dryRun": true,
  "posts": [
    {
      "clientRef": "R2-PIT-R685-HA-261112-0800",
      "mediaAssetId": "uuid",
      "account": "@pit_viagens",
      "mediaType": "REELS",
      "caption": "texto",
      "scheduledAt": "2026-11-12T08:00:00-03:00",
      "shareToFeed": true
    }
  ]
}
```

- Até 100 posts. **Tudo ou nada**: qualquer problema recusa o lote inteiro (422, com `problems` por item).
- `account` aceita o id da conta ou o `@username`.
- `scheduledAt: null` publica agora; o limite é de 90 dias à frente.
- `clientRef` é a proteção contra duplicata: um código que já virou post não cria outro, e volta com `outcome: "existing"`. O índice único `(workspace_id, client_ref)` garante isso mesmo com dois envios ao mesmo tempo (409).
- As regras são as mesmas da tela Publicar (`lib/publishing/batch.ts`): o mesmo vídeo não sai como Reel duas vezes na mesma conta, dois posts não ficam a menos de 15 min na mesma conta (inclusive dentro do lote), a conta precisa da permissão de publicação e o vídeo precisa seguir as regras da Meta.

`GET /api/scheduled-posts/batch?batchId=...` ou `?clientRef=A&clientRef=B` → situação de cada post (`scheduled`, `processing`, `published`, `failed`, `canceled`), `permalink` e `last_error`.

## Script

`node scripts/pitchat-agendar.mjs plano.json` sobe os vídeos (comprime com ffmpeg os que passam de 45 MB) e mostra a revisão. Só agenda com `--confirmar`. O formato do plano está no topo do script. O script lê `PITCHAT_API_TOKEN` do `.env.local`.
