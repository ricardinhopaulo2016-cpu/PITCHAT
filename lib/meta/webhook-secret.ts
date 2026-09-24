/**
 * Secret usado pra validar `X-Hub-Signature-256` do webhook do Instagram.
 *
 * Achado real, confirmado byte a byte em 24/09/2026 (HMAC-SHA256 dos bytes
 * brutos recebidos, comparado offline contra as duas chaves do projeto em
 * 5+ entregas reais): o webhook do produto "Instagram API with Instagram
 * Login" é assinado pela Meta com o **Instagram App Secret**
 * (`INSTAGRAM_APP_SECRET`, o mesmo já usado no fluxo OAuth — ver
 * lib/meta/oauth.ts) — NUNCA com o Meta App Secret "principal"
 * (`META_APP_SECRET`, que segue existindo só pra config a nível de App
 * Dashboard, ver docs/PITCHAT_META_INTEGRATION.md §1/§6). `META_APP_SECRET`
 * nunca validou nenhuma entrega real desde o início do projeto, mesmo
 * confirmado idêntico ao valor do App Dashboard e redeployado múltiplas
 * vezes — só trocar pro `INSTAGRAM_APP_SECRET` resolveu.
 *
 * Extraído numa função própria (em vez de inline no route handler) só pra
 * ficar testável isoladamente sem precisar mockar Supabase/QStash/Next —
 * mesmo padrão de lib/meta/api-version.ts::getGraphApiVersion. Nunca
 * reverter essa escolha sem um novo teste real contra produção.
 */
export function getWebhookSigningSecret(): string | undefined {
  return process.env.INSTAGRAM_APP_SECRET;
}
