import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { needsRefresh, refreshLongLivedToken } from "@/lib/meta/oauth";
import { decryptToken, encryptToken } from "@/lib/meta/token-crypto";
import { classifyRefreshFailure, outcomeRequiresReconnect } from "@/lib/meta/token-maintenance";

export const runtime = "nodejs";

type SocialAccountRow = {
  id: string;
  workspace_id: string;
  access_token_encrypted: string | null;
  token_expires_at: string | null;
};

/**
 * Job diário de manutenção de token — gap real encontrado na auditoria de
 * 24/09/2026: `refreshLongLivedToken`/`needsRefresh` existiam desde o início
 * mas nenhuma rotina os chamava. Sem isso, toda conta conectada expirava
 * sozinha em até 60 dias, sem nenhum aviso. Agendado via `vercel.json`
 * (`crons`) — Vercel manda `Authorization: Bearer $CRON_SECRET` nessas
 * chamadas quando `CRON_SECRET` está configurado; é isso que verificamos
 * abaixo pra ninguém mais conseguir disparar este endpoint.
 *
 * Nunca desconecta uma conta por falha transitória (rede, rate limit) — só
 * por falha que a Meta classificou como definitiva (ver
 * lib/meta/token-maintenance.ts). Nunca loga o token em lugar nenhum.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const { data: accounts, error: fetchError } = await admin
    .from("social_accounts")
    .select("id, workspace_id, access_token_encrypted, token_expires_at")
    .eq("platform", "instagram")
    .eq("status", "connected")
    .returns<SocialAccountRow[]>();

  if (fetchError) {
    return NextResponse.json({ error: "DB_ERROR", detail: fetchError.message }, { status: 500 });
  }

  const results: { socialAccountId: string; outcome: string }[] = [];
  const now = new Date().toISOString();

  for (const account of accounts ?? []) {
    if (!account.access_token_encrypted || !account.token_expires_at) continue;

    if (!needsRefresh(new Date(account.token_expires_at))) {
      results.push({ socialAccountId: account.id, outcome: "refresh_skipped_not_due" });
      continue;
    }

    try {
      const currentToken = decryptToken(account.access_token_encrypted);
      const refreshed = await refreshLongLivedToken(currentToken);

      await admin
        .from("social_accounts")
        .update({
          access_token_encrypted: encryptToken(refreshed.accessToken),
          token_expires_at: refreshed.expiresAt.toISOString(),
          status_detail: null,
          updated_at: now,
        })
        .eq("id", account.id);

      await admin.from("jobs").insert({
        workspace_id: account.workspace_id,
        type: "refresh_meta_token",
        payload: { socialAccountId: account.id },
        status: "succeeded",
        completed_at: now,
      });

      results.push({ socialAccountId: account.id, outcome: "refresh_success" });
    } catch (err) {
      const outcome = classifyRefreshFailure(err);
      const message = err instanceof Error ? err.message : String(err); // nunca inclui o token — MetaApiError/Error nunca carregam o token, só mensagem/código da Meta

      if (outcomeRequiresReconnect(outcome)) {
        await admin
          .from("social_accounts")
          .update({ status: "expired", status_detail: outcome, updated_at: now })
          .eq("id", account.id);
      }

      await admin.from("jobs").insert({
        workspace_id: account.workspace_id,
        type: "refresh_meta_token",
        payload: { socialAccountId: account.id },
        status: "failed",
        last_error: { message, outcome },
        completed_at: now,
      });

      results.push({ socialAccountId: account.id, outcome });
    }
  }

  return NextResponse.json({ ok: true, results });
}
