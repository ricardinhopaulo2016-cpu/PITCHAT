import { NextResponse } from "next/server";
import { getQstashReceiver, getAppUrl } from "@/lib/qstash";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { captureReelSnapshot } from "@/lib/insights/capture";

export const runtime = "nodejs";

/** Callback do QStash (assinatura verificada): tira a foto de métricas de um Reel numa idade. */
export async function POST(request: Request) {
  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const receiver = getQstashReceiver();
  const appUrl = getAppUrl();
  if (!receiver || !appUrl) return NextResponse.json({ error: "QSTASH_NOT_CONFIGURED" }, { status: 503 });

  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const isValid = signature
    ? await receiver.verify({ signature, body: rawBody, url: `${appUrl}/api/jobs/snapshot-reel` }).catch(() => false)
    : false;
  if (!isValid) return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });

  const { postId, ageHours } = JSON.parse(rawBody) as { postId?: string; ageHours?: number };
  if (!postId || typeof ageHours !== "number") return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  try {
    const outcome = await captureReelSnapshot(admin, postId, ageHours);
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    // Só erro de banco chega aqui: 500 faz o QStash tentar de novo, e a foto é idempotente.
    return NextResponse.json({ error: "SNAPSHOT_FAILED", detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
