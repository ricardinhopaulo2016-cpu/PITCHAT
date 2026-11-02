import { NextResponse } from "next/server";
import { getQstashReceiver, getAppUrl } from "@/lib/qstash";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { advanceScheduledPost } from "@/lib/publishing/engine";
import { buildAdvanceDeps } from "@/lib/publishing/deps";

export const runtime = "nodejs";

/** Callback do QStash: só ele chama isto (assinatura verificada). Avança um passo do post. */
export async function POST(request: Request) {
  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const receiver = getQstashReceiver();
  const appUrl = getAppUrl();
  if (!receiver || !appUrl) return NextResponse.json({ error: "QSTASH_NOT_CONFIGURED" }, { status: 503 });

  const rawBody = await request.text();
  const signature = request.headers.get("upstash-signature");
  const isValid = signature
    ? await receiver.verify({ signature, body: rawBody, url: `${appUrl}/api/jobs/advance-scheduled-post` }).catch(() => false)
    : false;
  if (!isValid) return NextResponse.json({ error: "INVALID_SIGNATURE" }, { status: 401 });

  const { postId } = JSON.parse(rawBody) as { postId?: string };
  if (!postId) return NextResponse.json({ error: "INVALID_BODY" }, { status: 400 });

  try {
    const outcome = await advanceScheduledPost(buildAdvanceDeps(admin), postId);
    return NextResponse.json({ ok: true, outcome });
  } catch (err) {
    // 500 faz o QStash retentar. O passo é idempotente, então repetir é seguro.
    return NextResponse.json({ error: "ADVANCE_FAILED", detail: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
