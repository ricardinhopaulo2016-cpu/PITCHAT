import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildAuthorizationUrl, buildOAuthState, getMetaOAuthConfig } from "@/lib/meta/oauth";

export const runtime = "nodejs";

/**
 * Inicia o fluxo: /api/auth/meta/start?profileId=... redireciona pra tela de autorização do Instagram.
 * - sem `reconnect`: "adicionar conta" ao perfil (pode ser a 2ª, 3ª... conta do mesmo perfil).
 * - `&reconnect=<social_accounts.id>`: "reconectar ESTA conta" — o callback confere se a conta
 *   autorizada na Meta é a mesma e recusa (sem alterar nada) se não for.
 */
export async function GET(request: Request) {
  const auth = await getAuthContext();
  if (!auth) return NextResponse.redirect(new URL("/login", request.url));

  const config = getMetaOAuthConfig();
  if (!config) {
    return NextResponse.json({ error: "META_NOT_CONFIGURED" }, { status: 503 });
  }

  const profileId = new URL(request.url).searchParams.get("profileId");
  if (!profileId) {
    return NextResponse.json({ error: "PROFILE_ID_REQUIRED" }, { status: 400 });
  }

  // Confirma que o profile é mesmo do workspace de quem está pedindo —
  // nunca confia só no query param.
  const admin = getSupabaseAdminClient();
  const { data: profile } = await admin
    ?.from("profiles")
    .select("id")
    .eq("id", profileId)
    .eq("workspace_id", auth.workspace.id)
    .maybeSingle() ?? { data: null };
  if (!profile) {
    return NextResponse.json({ error: "PROFILE_NOT_FOUND" }, { status: 404 });
  }

  const reconnectId = new URL(request.url).searchParams.get("reconnect");
  if (reconnectId) {
    const { data: target } = await admin!
      .from("social_accounts")
      .select("id")
      .eq("id", reconnectId)
      .eq("workspace_id", auth.workspace.id)
      .eq("profile_id", profileId)
      .eq("platform", "instagram")
      .maybeSingle();
    if (!target) return NextResponse.json({ error: "SOCIAL_ACCOUNT_NOT_FOUND" }, { status: 404 });
  }

  const state = buildOAuthState(auth.workspace.id, profileId, config.instagramAppSecret, reconnectId ?? undefined);
  return NextResponse.redirect(buildAuthorizationUrl(config, state));
}
