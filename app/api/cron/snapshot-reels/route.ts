import { NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { captureReelSnapshot } from "@/lib/insights/capture";
import { dueSnapshotAges } from "@/lib/insights/reel-snapshots";

export const runtime = "nodejs";
export const maxDuration = 60;

const LOOKBACK_MS = 9 * 24 * 60 * 60_000;

/**
 * Reserva diária das fotos de métricas: pega a idade que a fila não entregou
 * (ou que ela recusou, como a de 7 dias) enquanto ainda está dentro da
 * tolerância. Chamado pelo cron da Vercel com CRON_SECRET.
 */
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });
  }

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const now = new Date();
  const { data: posts, error } = await admin
    .from("scheduled_posts")
    .select("id, social_account_id, external_media_id, published_at")
    .eq("status", "published")
    .eq("media_type", "REELS")
    .not("external_media_id", "is", null)
    .gte("published_at", new Date(now.getTime() - LOOKBACK_MS).toISOString());
  if (error) return NextResponse.json({ error: "DB_ERROR", detail: error.message }, { status: 500 });

  const mediaIds = (posts ?? []).map((p) => p.external_media_id as string);
  const { data: taken } = mediaIds.length
    ? await admin.from("reel_insight_snapshots").select("external_media_id, age_hours").in("external_media_id", mediaIds)
    : { data: [] };
  const takenByMedia = new Map<string, Set<number>>();
  for (const row of taken ?? []) {
    const set = takenByMedia.get(row.external_media_id) ?? new Set<number>();
    set.add(row.age_hours);
    takenByMedia.set(row.external_media_id, set);
  }

  const results: { postId: string; age: number; outcome: string }[] = [];
  for (const post of posts ?? []) {
    const due = dueSnapshotAges(post.published_at as string, now, takenByMedia.get(post.external_media_id as string) ?? new Set());
    for (const age of due) {
      try {
        results.push({ postId: post.id, age, outcome: await captureReelSnapshot(admin, post.id, age) });
      } catch (err) {
        results.push({ postId: post.id, age, outcome: `error: ${err instanceof Error ? err.message : String(err)}` });
      }
    }
  }

  return NextResponse.json({ ok: true, checked: posts?.length ?? 0, results });
}
