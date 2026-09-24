import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { verifyMetaWebhookSignature } from "@/lib/meta/signature";
import { getWebhookSigningSecret } from "@/lib/meta/webhook-secret";
import { classifyWebhookEventType } from "@/lib/meta/events";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { scheduleWebhookProcessing, isQstashConfigured } from "@/lib/qstash";

export const runtime = "nodejs";

/**
 * Verificação inicial do webhook (Meta chama isso uma vez, ao configurar).
 * GET /api/webhooks/meta?hub.mode=subscribe&hub.challenge=...&hub.verify_token=...
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN;

  if (mode === "subscribe" && expectedToken && token === expectedToken && challenge) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

/**
 * Evento real. Nunca processa a automação aqui dentro — só valida, persiste
 * e enfileira (seção 6 do briefing). Resposta rápida é o que importa.
 */
export async function POST(request: Request) {
  // Ver lib/meta/webhook-secret.ts::getWebhookSigningSecret pro achado real
  // (24/09/2026) de por que é INSTAGRAM_APP_SECRET, nunca META_APP_SECRET.
  const webhookSigningSecret = getWebhookSigningSecret();
  const admin = getSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!webhookSigningSecret) {
    return NextResponse.json({ error: "META_NOT_CONFIGURED" }, { status: 503 });
  }

  // Bytes brutos exatos, sem passar pelo decode de `.text()` primeiro —
  // elimina qualquer dúvida de que um re-encode intermediário (proxy,
  // Content-Type declarado diferente, etc.) esteja mudando o corpo antes do
  // HMAC. `rawBody` (string) deriva DESSES mesmos bytes, nunca o contrário.
  const rawBytes = Buffer.from(await request.arrayBuffer());
  const rawBody = rawBytes.toString("utf8");
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyMetaWebhookSignature(rawBody, signature, webhookSigningSecret)) {
    // Gap real de observabilidade descoberto durante o primeiro teste E2E
    // (10/09/2026): antes disso, uma assinatura inválida só retornava 401 e
    // NUNCA gravava nada. `receivedSignatureHeader` (o HMAC que a Meta
    // mandou, não é segredo) foi o que permitiu confirmar o bug do
    // parágrafo acima comparando offline contra as duas chaves.
    const externalEventId = createHash("sha256").update(rawBody).digest("hex");
    await admin.from("webhook_events").upsert(
      {
        provider: "meta",
        external_event_id: externalEventId,
        event_type: "invalid_signature",
        payload: { rawBodyPreview: rawBody.slice(0, 2000) },
        status: "failed",
        last_error: {
          reason: "INVALID_SIGNATURE",
          signatureHeaderPresent: !!signature,
          receivedSignatureHeader: signature,
        },
      },
      { onConflict: "provider,external_event_id", ignoreDuplicates: true }
    );
    return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });
  }

  const payload = JSON.parse(rawBody);

  // Idempotência da ENTREGA do webhook (não confundir com a idempotência por
  // comentário/mensagem, que é feita depois — ver lib/automation/ingest.ts).
  // Meta pode reenviar a mesma entrega; hash do corpo bruto detecta isso.
  const externalEventId = createHash("sha256").update(rawBody).digest("hex");
  const eventType = classifyWebhookEventType(payload);

  const { data: webhookEvent, error: insertError } = await admin
    .from("webhook_events")
    .upsert(
      {
        provider: "meta",
        external_event_id: externalEventId,
        event_type: eventType,
        payload,
        status: "pending",
      },
      { onConflict: "provider,external_event_id", ignoreDuplicates: true }
    )
    .select("id")
    .maybeSingle();

  if (insertError) {
    return NextResponse.json({ error: "DB_ERROR" }, { status: 500 });
  }

  // 200 rápido pra Meta SEMPRE que a gente já tiver o evento persistido —
  // seja porque acabou de chegar (webhookEvent existe) seja porque já era
  // uma entrega duplicada (webhookEvent null = ignorado pelo upsert, mas o
  // registro original já está lá processando/processado).
  if (!webhookEvent) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  if (!isQstashConfigured()) {
    // Não processa aqui dentro (regra do briefing). Sem QStash, o evento
    // fica 'pending' no banco — precisa ser reprocessado manualmente depois
    // que QSTASH_TOKEN existir. Isso é visível em logs, nunca fingimos que
    // processou.
    await admin
      .from("webhook_events")
      .update({ status: "failed", last_error: { reason: "QSTASH_NOT_CONFIGURED" } })
      .eq("id", webhookEvent.id);
    return NextResponse.json({ ok: true, queued: false });
  }

  const scheduled = await scheduleWebhookProcessing({ webhookEventId: webhookEvent.id });
  if (!scheduled.ok) {
    await admin
      .from("webhook_events")
      .update({ status: "failed", last_error: { reason: scheduled.reason } })
      .eq("id", webhookEvent.id);
  }

  return NextResponse.json({ ok: true, queued: scheduled.ok });
}
