import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  fetchInstagramIdentity,
  getMetaOAuthConfig,
  subscribeAccountToWebhooks,
  verifyOAuthState,
} from "@/lib/meta/oauth";
import { encryptToken } from "@/lib/meta/token-crypto";
import { decideAccountLink, type LinkableAccount } from "@/lib/meta/account-link";
import { logOAuthCallbackFailure, toSafeErrorDetail } from "@/lib/meta/oauth-errors";

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

    // NUNCA usar shortLived.userId como identidade da conta — é um ID
    // app-scoped, diferente do `entry.id` que chega nos webhooks reais (ver
    // comentário completo em lib/meta/oauth.ts::fetchInstagramIdentity).
    // `fetchInstagramIdentity` resolve o ID real (`user_id` de `GET /me`),
    // o mesmo que a Meta usa em todo webhook — é esse que precisa ir pra
    // `external_account_id`, senão o lookup em process-webhook-event nunca
    // casa e a automação fica inerte sem nenhum erro visível.
    const identity = await fetchInstagramIdentity(longLived.accessToken);

    // Decide ANTES de qualquer efeito colateral (assinatura de webhook, escrita):
    // "adicionar conta" vs "reconectar" nunca pode sobrescrever/reassociar uma
    // conta por acidente (Fase D0). `social_accounts` é único por
    // (platform, external_account_id); um profile pode ter várias contas.
    const linkColumns = "id, workspace_id, profile_id, external_account_id";
    const [{ data: existing }, { data: reconnectTarget }] = await Promise.all([
      admin
        .from("social_accounts")
        .select(linkColumns)
        .eq("platform", "instagram")
        .eq("external_account_id", identity.igUserId)
        .maybeSingle<LinkableAccount>(),
      parsedState.reconnectAccountId
        ? admin
            .from("social_accounts")
            .select(linkColumns)
            .eq("id", parsedState.reconnectAccountId)
            .eq("workspace_id", parsedState.workspaceId)
            .eq("profile_id", parsedState.profileId)
            .maybeSingle<LinkableAccount>()
        : Promise.resolve({ data: null }),
    ]);

    const decision = decideAccountLink({
      workspaceId: parsedState.workspaceId,
      profileId: parsedState.profileId,
      authorizedExternalId: identity.igUserId,
      existing: existing ?? null,
      reconnectTarget: reconnectTarget ?? null,
      reconnectRequested: !!parsedState.reconnectAccountId,
    });
    if (decision.action === "reject") return redirectToSocialAccounts("error", decision.reason);

    // Assinar o app a nível de App Dashboard NÃO é suficiente — cada conta
    // precisa individualmente "optar" por mandar eventos pro nosso app (ver
    // comentário em lib/meta/oauth.ts::subscribeAccountToWebhooks). Achado
    // real no primeiro teste E2E: sem isso, webhook_events nunca recebe nada
    // pra essa conta, sem nenhum erro visível em lugar nenhum.
    const webhookSubscribed = await subscribeAccountToWebhooks(longLived.accessToken, identity.igUserId);

    const credentials = {
      username: identity.username,
      access_token_encrypted: encryptToken(longLived.accessToken),
      token_expires_at: longLived.expiresAt.toISOString(),
      permissions: shortLived.permissions,
      status: "connected",
      // Não falha a conexão inteira por isso (o OAuth em si funcionou) —
      // mas nunca finge que o webhook está ativo se a chamada falhou.
      status_detail: webhookSubscribed ? null : "webhook_subscription_failed",
    };

    // update só toca credenciais — nunca workspace_id/profile_id da linha existente.
    const { error: upsertError } =
      decision.action === "update"
        ? await admin.from("social_accounts").update(credentials).eq("id", decision.accountId)
        : await admin.from("social_accounts").insert({
            workspace_id: parsedState.workspaceId,
            profile_id: parsedState.profileId,
            platform: "instagram",
            external_account_id: identity.igUserId,
            ...credentials,
          });

    if (upsertError) return redirectToSocialAccounts("error", "db_error");

    return redirectToSocialAccounts(webhookSubscribed ? "connected" : "error", webhookSubscribed ? undefined : "webhook_subscription_failed");
  } catch (err) {
    // Diagnóstico completo SÓ no log do servidor (sem credenciais); a URL leva
    // apenas um identificador categorizado — nunca a mensagem técnica da Meta.
    logOAuthCallbackFailure(err, [config.instagramAppSecret, code]);
    return redirectToSocialAccounts("error", toSafeErrorDetail(err));
  }
}
