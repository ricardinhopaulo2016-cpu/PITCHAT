import { NextResponse } from "next/server";
import { getQstashReceiver, getAppUrl } from "@/lib/qstash";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizeMetaWebhookPayload, type RawMetaWebhookPayload } from "@/lib/meta/events";
import { ingestInstagramComment, ingestInstagramQuickReply } from "@/lib/automation/ingest";
import { realMetaClient } from "@/lib/meta/client";

export const runtime = "nodejs";

/**
 * Callback do QStash — processa um webhook_event já persistido. Nunca é
 * chamado direto pela Meta, só pelo QStash (assinatura verificada abaixo).
 */
export async function POST(request: Request) {
  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const receiver = getQstashReceiver();
  const appUrl = getAppUrl();
  if (!receiver || !appUrl) {
    return NextResponse.json({ error: "QSTASH_NOT_CONFIGURED" }, { status: 503 });
  }

  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const isValid = signature
    ? await receiver
        .verify({ signature, body: rawBody, url: `${appUrl}/api/jobs/process-webhook-event` })
        .catch(() => false)
    : false;

  if (!isValid) {
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  const { webhookEventId } = JSON.parse(rawBody) as { webhookEventId?: string };
  if (!webhookEventId) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  const { data: webhookEvent } = await admin
    .from("webhook_events")
    .select("id, status, payload")
    .eq("id", webhookEventId)
    .maybeSingle();

  if (!webhookEvent) return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });

  // Idempotência: se outro worker já processou (ou está processando), no-op.
  if (webhookEvent.status === "processed") {
    return NextResponse.json({ ok: true, alreadyProcessed: true });
  }

  await admin
    .from("webhook_events")
    .update({ status: "processing", attempts: (webhookEvent as { attempts?: number }).attempts ?? 1 })
    .eq("id", webhookEventId)
    .eq("status", webhookEvent.status); // claim otimista — se mudou, outro worker já pegou

  try {
    const events = normalizeMetaWebhookPayload(webhookEvent.payload as RawMetaWebhookPayload);

    for (const event of events) {
      const { data: socialAccount } = await admin
        .from("social_accounts")
        .select("id, workspace_id, profile_id, external_account_id, access_token_encrypted")
        .eq("platform", "instagram")
        .eq("external_account_id", event.externalAccountId)
        .maybeSingle();

      if (!socialAccount) continue; // conta não conectada no PITCHAT — nada a fazer

      if (event.type === "InstagramCommentReceived") {
        await ingestInstagramComment(admin, realMetaClient, socialAccount, event);
      } else if (event.type === "InstagramQuickReplyReceived") {
        await ingestInstagramQuickReply(admin, realMetaClient, socialAccount, event);
      }
      // InstagramMessageReceived (DM avulsa, sem quick reply) não dispara
      // flow no V1 — trigger suportado é só comentário, por enquanto.
    }

    await admin
      .from("webhook_events")
      .update({ status: "processed", processed_at: new Date().toISOString() })
      .eq("id", webhookEventId);

    return NextResponse.json({ ok: true });
  } catch (err) {
    await admin
      .from("webhook_events")
      .update({
        status: "failed",
        last_error: { message: err instanceof Error ? err.message : String(err) },
      })
      .eq("id", webhookEventId);
    // 500 pro QStash retentar (attempts/backoff configurados na publicação).
    return NextResponse.json({ error: "PROCESSING_FAILED" }, { status: 500 });
  }
}
