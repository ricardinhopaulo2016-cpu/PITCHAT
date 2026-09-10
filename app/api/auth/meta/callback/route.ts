import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  fetchInstagramProfile,
  getMetaOAuthConfig,
  subscribeAccountToWebhooks,
  verifyOAuthState,
} from "@/lib/meta/oauth";
import { encryptToken } from "@/lib/meta/token-crypto";

export const runtime = "nodejs";

/**
 * Callback do OAuth — a Meta redireciona o navegador do usuário pra cá com
 * ?code=...&state=.... Nunca testado contra a API real ainda (bloqueado até
 * existir Meta App). Fluxo: valida state -> troca code por token curto ->
 * exchange pra long-lived -> busca username -> grava social_accounts.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const errorParam = url.searchParams.get("error");

  const redirectToSocialAccounts = (status: "connected" | "error", detail?: string) => {
    const dest = new URL("/dashboard/social-accounts", request.url);
    dest.searchParams.set("status", status);
    if (detail) dest.searchParams.set("detail", detail);
    return NextResponse.redirect(dest);
  };

  if (errorParam) {
    // Usuário cancelou a autorização na tela da Meta.
    return redirectToSocialAccounts("error", "authorization_denied");
  }

  const config = getMetaOAuthConfig();
  if (!config) return redirectToSocialAccounts("error", "meta_not_configured");
  if (!code || !state) return redirectToSocialAccounts("error", "missing_code_or_state");

  const parsedState = verifyOAuthState(state, config.instagramAppSecret);
  if (!parsedState) return redirectToSocialAccounts("error", "invalid_state");

  const admin = getSupabaseAdminClient();
  if (!admin) return redirectToSocialAccounts("error", "supabase_not_configured");

  try {
    const shortLived = await exchangeCodeForShortLivedToken(config, code);
    const longLived = await exchangeForLongLivedToken(config, shortLived.accessToken);
    const profile = await fetchInstagramProfile(longLived.accessToken, shortLived.userId);

    // Assinar o app a nível de App Dashboard NÃO é suficiente — cada conta
    // precisa individualmente "optar" por mandar eventos pro nosso app (ver
    // comentário em lib/meta/oauth.ts::subscribeAccountToWebhooks). Achado
    // real no primeiro teste E2E: sem isso, webhook_events nunca recebe nada
    // pra essa conta, sem nenhum erro visível em lugar nenhum.
    const webhookSubscribed = await subscribeAccountToWebhooks(longLived.accessToken, shortLived.userId);

    const { error: upsertError } = await admin.from("social_accounts").upsert(
      {
        workspace_id: parsedState.workspaceId,
        profile_id: parsedState.profileId,
        platform: "instagram",
        external_account_id: shortLived.userId,
        username: profile.username,
        access_token_encrypted: encryptToken(longLived.accessToken),
        token_expires_at: longLived.expiresAt.toISOString(),
        permissions: shortLived.permissions,
        status: "connected",
        // Não falha a conexão inteira por isso (o OAuth em si funcionou) —
        // mas nunca finge que o webhook está ativo se a chamada falhou.
        status_detail: webhookSubscribed ? null : "webhook_subscription_failed",
      },
      { onConflict: "platform,external_account_id" }
    );

    if (upsertError) return redirectToSocialAccounts("error", "db_error");

    return redirectToSocialAccounts(webhookSubscribed ? "connected" : "error", webhookSubscribed ? undefined : "webhook_subscription_failed");
  } catch (err) {
    return redirectToSocialAccounts("error", err instanceof Error ? err.message : "unknown_error");
  }
}
