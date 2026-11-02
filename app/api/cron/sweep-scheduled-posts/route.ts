import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { schedulePostAdvance } from "@/lib/qstash";
import { startKey } from "@/lib/publishing/engine";

export const runtime = "nodejs";

const DAY_MS = 24 * 60 * 60_000;
const STUCK_AFTER_MS = 15 * 60_000;

/**
 * Rede de segurança diária. Enfileira o que vence nas próximas 24h e ainda não
 * pôde entrar na fila (agendamento além do atraso máximo do QStash) e retoma
 * post preso em "processing" por uma falha ao enfileirar o próximo passo.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const now = Date.now();
  const [{ data: due, error: dueError }, { data: stuck, error: stuckError }] = await Promise.all([
    admin
      .from("scheduled_posts")
      .select("id, scheduled_at")
      .eq("status", "scheduled")
      .lte("scheduled_at", new Date(now + DAY_MS).toISOString()),
    admin
      .from("scheduled_posts")
      .select("id, updated_at")
      .eq("status", "processing")
      .lte("updated_at", new Date(now - STUCK_AFTER_MS).toISOString()),
  ]);
  if (dueError || stuckError) {
    return NextResponse.json({ error: "DB_ERROR", detail: dueError?.message ?? stuckError?.message }, { status: 500 });
  }

  const results = await Promise.all([
    ...(due ?? []).map((post) =>
      schedulePostAdvance({
        postId: post.id,
        delaySeconds: Math.max(0, Math.ceil((new Date(post.scheduled_at).getTime() - now) / 1000)),
        deduplicationId: startKey(post),
      })
    ),
    ...(stuck ?? []).map((post) =>
      schedulePostAdvance({ postId: post.id, delaySeconds: 0, deduplicationId: `${post.id}-sweep-${new Date(post.updated_at).getTime()}` })
    ),
  ]);

  return NextResponse.json({ ok: true, due: due?.length ?? 0, stuck: stuck?.length ?? 0, failedToQueue: results.filter((r) => !r.ok).length });
}
