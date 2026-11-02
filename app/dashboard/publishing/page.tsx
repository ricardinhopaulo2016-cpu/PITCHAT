import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { SignalMarker } from "@/components/icons/pitchat";
import { accountCanPublish } from "@/lib/publishing/validate";
import { friendlyPublishError } from "@/lib/publishing/messages";
import type { PublishError } from "@/lib/publishing/engine";
import { AutoRefreshWhilePending } from "../media/auto-refresh";
import { Composer, type ComposerAsset } from "./composer";
import { PostActions } from "./post-actions";
import { dayKey, formatClock, formatDayHeading, formatPostTime } from "./format";

const ASSET_LIMIT = 60;
const POST_LIMIT = 200;
const PREVIEW_TTL_SECONDS = 60 * 60;
const HISTORY_DAYS = 14;

type PostRow = {
  id: string;
  media_type: "REELS" | "STORIES";
  caption: string | null;
  scheduled_at: string;
  published_at: string | null;
  status: string;
  permalink: string | null;
  last_error: PublishError | null;
  account: { username: string | null } | null;
  asset: { original_filename: string | null } | null;
};

function historyStart(): string {
  return new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60_000).toISOString();
}

export default async function PublishingPage() {
  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return <p className="p-8 text-sm text-danger">O sistema ainda não está configurado.</p>;
  }

  const since = historyStart();
  const [{ data: accountRows }, { data: assetRows }, { data: postRows, error: postsError }] = await Promise.all([
    admin
      .from("social_accounts")
      .select("id, username, status, permissions")
      .eq("workspace_id", auth.workspace.id)
      .eq("platform", "instagram")
      .neq("status", "revoked")
      .order("created_at", { ascending: true }),
    admin
      .from("media_assets")
      .select("id, original_filename, storage_key, mime_type, file_size, duration_ms, width, height, fps, codec")
      .eq("workspace_id", auth.workspace.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(ASSET_LIMIT),
    admin
      .from("scheduled_posts")
      .select(
        "id, media_type, caption, scheduled_at, published_at, status, permalink, last_error, account:social_accounts(username), asset:media_assets(original_filename)"
      )
      .eq("workspace_id", auth.workspace.id)
      .gte("scheduled_at", since)
      .neq("status", "canceled")
      .order("scheduled_at", { ascending: true })
      .limit(POST_LIMIT)
      .returns<PostRow[]>(),
  ]);

  // Bucket privado: a prévia usa URL assinada, em lote para não fazer uma chamada por arquivo.
  const keys = (assetRows ?? []).map((a) => a.storage_key as string);
  const { data: signed } = keys.length
    ? await admin.storage.from("media").createSignedUrls(keys, PREVIEW_TTL_SECONDS)
    : { data: [] };
  const urlByKey = new Map((signed ?? []).map((s) => [s.path, s.signedUrl]));

  const assets: ComposerAsset[] = (assetRows ?? []).map((a) => ({
    id: a.id,
    original_filename: a.original_filename,
    mime_type: a.mime_type,
    file_size: a.file_size,
    duration_ms: a.duration_ms,
    width: a.width,
    height: a.height,
    fps: a.fps,
    codec: a.codec,
    url: urlByKey.get(a.storage_key) ?? null,
  }));

  const accounts = (accountRows ?? []).map((a) => ({ id: a.id, username: a.username, canPublish: accountCanPublish(a) }));

  const posts = postRows ?? [];
  const upcoming = posts.filter((p) => p.status === "scheduled" || p.status === "processing");
  const failed = posts.filter((p) => p.status === "failed").reverse();
  const published = posts.filter((p) => p.status === "published").reverse();

  return (
    <>
      <AutoRefreshWhilePending active={posts.some((p) => p.status === "processing")} />

      <PageHeader title="Publicar" description="Reels e Stories no Instagram. Horários em Brasília." />

      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 pb-10 md:px-8">
        <Composer assets={assets} accounts={accounts} />

        {postsError && <p className="text-sm text-danger">Não foi possível carregar os posts agora.</p>}

        {failed.length > 0 && (
          <Section title="Com erro" count={failed.length}>
            <PostList posts={failed} />
          </Section>
        )}

        <Section title="Na fila" count={upcoming.length}>
          {upcoming.length === 0 ? (
            <EmptyState title="Nada agendado" description="Os próximos posts aparecem aqui, separados por dia." />
          ) : (
            <div className="flex flex-col gap-5">
              {groupByDay(upcoming).map((group) => (
                <div key={group.key} className="flex flex-col gap-2">
                  <h3 className="text-xs font-medium capitalize text-text-muted">{formatDayHeading(group.posts[0].scheduled_at)}</h3>
                  <PostList posts={group.posts} clockOnly />
                </div>
              ))}
            </div>
          )}
        </Section>

        {published.length > 0 && (
          <Section title={`Publicados nos últimos ${HISTORY_DAYS} dias`} count={published.length}>
            <PostList posts={published} />
          </Section>
        )}
      </div>
    </>
  );
}

function groupByDay(posts: PostRow[]) {
  const groups: { key: string; posts: PostRow[] }[] = [];
  for (const post of posts) {
    const key = dayKey(post.scheduled_at);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.posts.push(post);
    else groups.push({ key, posts: [post] });
  }
  return groups;
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text">
        {title} <span className="font-normal text-text-muted">{count}</span>
      </h2>
      {children}
    </section>
  );
}

function PostList({ posts, clockOnly = false }: { posts: PostRow[]; clockOnly?: boolean }) {
  return (
    <ul className="divide-y divide-border-subtle overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
      {posts.map((post) => (
        <li key={post.id} className="flex items-center gap-4 px-4 py-3">
          <span className="w-24 shrink-0 text-sm tabular-nums text-text">
            {clockOnly ? formatClock(post.scheduled_at) : formatPostTime(post.published_at ?? post.scheduled_at)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-text">
              <span className="font-medium">@{post.account?.username ?? "conta"}</span>
              <span className="text-text-muted"> · {post.media_type === "REELS" ? "Reel" : "Story"}</span>
            </p>
            <p className="truncate text-xs text-text-muted">{post.caption ?? post.asset?.original_filename ?? "(sem legenda)"}</p>
            {post.status === "failed" && <p className="mt-1 text-xs text-danger">{friendlyPublishError(post.last_error)}</p>}
          </div>
          <PostStatus status={post.status} />
          {post.permalink && (
            <a href={post.permalink} target="_blank" rel="noreferrer" className="shrink-0 text-sm text-text-secondary underline hover:text-text">
              Ver post
            </a>
          )}
          <PostActions postId={post.id} status={post.status} />
        </li>
      ))}
    </ul>
  );
}

/** Status nunca depende só de cor (docs/PITCHAT_DESIGN_SYSTEM.md §12): símbolo + texto. */
function PostStatus({ status }: { status: string }) {
  const config =
    status === "published"
      ? { label: "Publicado", color: "var(--success)", marker: "action" as const }
      : status === "processing"
        ? { label: "Publicando", color: "var(--warning)", marker: "wait" as const }
        : status === "failed"
          ? { label: "Erro", color: "var(--danger)", marker: "error" as const }
          : { label: "Agendado", color: "var(--text-muted)", marker: "trigger" as const };
  return (
    <span className="hidden shrink-0 items-center gap-1.5 text-sm sm:inline-flex" style={{ color: config.color }}>
      <SignalMarker type={config.marker} width={10} height={10} style={{ color: config.color }} />
      {config.label}
    </span>
  );
}
