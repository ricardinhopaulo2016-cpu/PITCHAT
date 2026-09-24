import { NextResponse } from "next/server";
import { createHash, createHmac } from "node:crypto";
import { verifyMetaWebhookSignature } from "@/lib/meta/signature";
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
  const appSecret = process.env.META_APP_SECRET;
  const admin = getSupabaseAdminClient();

  if (!admin) {
    return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });
  }
  if (!appSecret) {
    return NextResponse.json({ error: "META_NOT_CONFIGURED" }, { status: 503 });
  }

  // Bytes brutos exatos, sem passar pelo decode de `.text()` primeiro —
  // elimina qualquer dúvida de que um re-encode intermediário (proxy,
  // Content-Type declarado diferente, etc.) esteja mudando o corpo antes do
  // HMAC. `rawBody` (string) deriva DESSES mesmos bytes, nunca o contrário.
  const rawBytes = Buffer.from(await request.arrayBuffer());
  const rawBody = rawBytes.toString("utf8");
  const signature = request.headers.get("x-hub-signature-256");

  if (!verifyMetaWebhookSignature(rawBody, signature, appSecret)) {
    // Diagnóstico definitivo (achado real 23-24/09/2026): META_APP_SECRET
    // seguia "inválido" mesmo depois de confirmado visualmente igual ao App
    // Secret mostrado em App settings → Basic — hipótese: talvez o webhook
    // do produto "Instagram API with Instagram Login" seja assinado com o
    // INSTAGRAM_APP_SECRET (o do Instagram App, usado hoje só no OAuth), não
    // com o Meta App Secret principal. Testa as DUAS chaves contra os MESMOS
    // bytes brutos recebidos, sem nunca logar nenhum dos dois secrets — só
    // booleano de match e um fingerprint SHA-256 truncado (one-way, serve só
    // pra diferenciar "qual secret é esse" sem expor o valor). Nunca aceita
    // nenhuma delas como válida aqui — só registra pra decidir depois.
    const igSecret = process.env.INSTAGRAM_APP_SECRET;
    const fingerprint = (secret: string | undefined) =>
      secret ? createHash("sha256").update(secret).digest("hex").slice(0, 12) : null;
    const signedWith = (secret: string | undefined) =>
      secret ? `sha256=${createHmac("sha256", secret).update(rawBytes).digest("hex")}` : null;

    const metaExpected = signedWith(appSecret);
    const igExpected = signedWith(igSecret);

    const externalEventId = createHash("sha256").update(rawBody).digest("hex");
    await admin.from("webhook_events").upsert(
      {
        provider: "meta",
        external_event_id: externalEventId,
        event_type: "invalid_signature",
        payload: { rawBodyPreview: rawBody.slice(0, 2000) },
        status: "failed",
        // `signature`/`*Expected` (HMACs) NÃO são segredo — são valores já
        // públicos por natureza (é isso que vai no header de toda entrega).
        // Só os secrets em si nunca são logados (só o fingerprint one-way).
        last_error: {
          reason: "INVALID_SIGNATURE",
          signatureHeaderPresent: !!signature,
          receivedSignatureHeader: signature,
          metaAppSecretMatch: !!signature && signature === metaExpected,
          instagramAppSecretMatch: !!signature && signature === igExpected,
          metaAppSecretFingerprint: fingerprint(appSecret),
          instagramAppSecretFingerprint: fingerprint(igSecret),
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
