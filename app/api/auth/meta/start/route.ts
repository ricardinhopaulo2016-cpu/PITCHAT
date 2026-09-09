import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { buildAuthorizationUrl, buildOAuthState, getMetaOAuthConfig } from "@/lib/meta/oauth";

export const runtime = "nodejs";

/** Inicia o fluxo: /api/auth/meta/start?profileId=... redireciona pra tela de autorização do Instagram. */
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

  const state = buildOAuthState(auth.workspace.id, profileId, config.appSecret);
  return NextResponse.redirect(buildAuthorizationUrl(config, state));
}
