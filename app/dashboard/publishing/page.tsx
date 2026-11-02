import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app-shell/page-header";
import { EmptyState } from "@/components/ui/empty-state";
import { AccountTile } from "@/components/ui/account-tile";
import { DateRangeFilter } from "@/components/ui/date-range-filter";
import { formatRange, parseRange, rangeToIso } from "@/lib/ui/date-range";
import { accountCanPublish } from "@/lib/publishing/validate";
import { friendlyPublishError } from "@/lib/publishing/messages";
import type { PublishError } from "@/lib/publishing/engine";
import { AutoRefreshWhilePending } from "../media/auto-refresh";
import { Composer, type ComposerAsset } from "./composer";
import { PostActions } from "./post-actions";
import { dayKey, formatClock, formatDayHeading, formatPostTime, isDayKey, shiftWeek, weekOf, type WeekDay } from "./format";

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
  social_account_id: string;
  account: { username: string | null } | null;
  asset: { original_filename: string | null } | null;
};

function historyStart(): string {
  return new Date(Date.now() - HISTORY_DAYS * 24 * 60 * 60_000).toISOString();
}

function today(): string {
  return dayKey(new Date().toISOString());
}

export default async function PublishingPage({ searchParams }: { searchParams: Promise<{ semana?: string; channel?: string; de?: string; ate?: string }> }) {
  const { semana, channel, de, ate } = await searchParams;
  const range = parseRange(de, ate);
  const reference = isDayKey(semana) ? semana : today();
  const week = weekOf(reference);

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) {
    return <p className="p-8 text-sm text-danger">O sistema ainda não está configurado.</p>;
  }

  const POST_COLUMNS =
    "id, media_type, caption, scheduled_at, published_at, status, permalink, last_error, social_account_id, account:social_accounts(username), asset:media_assets(original_filename)";
  const weekIso = rangeToIso({ from: week[0].key, to: week[6].key });
  const listIso = range ? rangeToIso(range) : null;
  const [{ data: accountRows }, { data: assetRows }, { data: postRows, error: postsError }, { data: weekRows }] = await Promise.all([
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
      .select(POST_COLUMNS)
      .eq("workspace_id", auth.workspace.id)
      .gte("scheduled_at", listIso?.start ?? historyStart())
      .lt("scheduled_at", listIso?.end ?? "9999-12-31")
      .neq("status", "canceled")
      .order("scheduled_at", { ascending: true })
      .limit(POST_LIMIT)
      .returns<PostRow[]>(),
    admin
      .from("scheduled_posts")
      .select(POST_COLUMNS)
      .eq("workspace_id", auth.workspace.id)
      .gte("scheduled_at", weekIso.start)
      .lt("scheduled_at", weekIso.end)
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

  const posts = (postRows ?? []).filter((p) => !channel || p.social_account_id === channel);
  const gridPosts = (weekRows ?? []).filter((p) => !channel || p.social_account_id === channel);
  const gridAccounts = channel ? accounts.filter((a) => a.id === channel) : accounts;
  const channelQuery = channel ? `&channel=${encodeURIComponent(channel)}` : "";
  const isThisWeek = week.some((d) => d.key === today());
  const upcoming = posts.filter((p) => p.status === "scheduled" || p.status === "processing");
  const failed = posts.filter((p) => p.status === "failed").reverse();
  const published = posts.filter((p) => p.status === "published").reverse();

  return (
    <>
      <AutoRefreshWhilePending active={[...posts, ...gridPosts].some((p) => p.status === "processing")} />

      <PageHeader
        title="Publicar"
        description="A semana inteira dos perfis numa grade. Horários em Brasília."
        action={
          <div className="flex items-center gap-2">
            {!isThisWeek && (
              <Link href={channel ? `/dashboard/publishing?channel=${encodeURIComponent(channel)}` : "/dashboard/publishing"} className="mr-1 text-sm text-text-secondary hover:text-text">
                Hoje
              </Link>
            )}
            <WeekLink href={`/dashboard/publishing?semana=${shiftWeek(reference, -1)}${channelQuery}`} label="Semana anterior">
              <ChevronLeft className="h-[18px] w-[18px]" />
            </WeekLink>
            <span className="px-2 font-medium text-text">
              {week[0].key.slice(8)}/{week[0].key.slice(5, 7)} a {week[6].key.slice(8)}/{week[6].key.slice(5, 7)}
            </span>
            <WeekLink href={`/dashboard/publishing?semana=${shiftWeek(reference, 1)}${channelQuery}`} label="Próxima semana">
              <ChevronRight className="h-[18px] w-[18px]" />
            </WeekLink>
          </div>
        }
      />

      <div className="grid grid-cols-1 items-start gap-4 px-6 pb-14 md:px-11 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-7">
          <WeekGrid week={week} accounts={gridAccounts} posts={gridPosts} todayKey={today()} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl font-semibold tracking-[-0.02em] text-text">Registro</h2>
            <DateRangeFilter emptyLabel={`Últimos ${HISTORY_DAYS} dias e a fila`} />
          </div>

          {postsError && <p className="text-sm text-danger">Não foi possível carregar os posts agora.</p>}

        {failed.length > 0 && (
          <Section title="Com erro" count={failed.length}>
            <PostList posts={failed} />
          </Section>
        )}

        <Section title="Na fila" count={upcoming.length}>
          {upcoming.length === 0 ? (
            <EmptyState title="Nada agendado" description={range ? "Nenhum post agendado neste período." : "Os próximos posts aparecem aqui, separados por dia."} />
          ) : (
            <div className="flex flex-col gap-5">
              {groupByDay(upcoming).map((group) => (
                <div key={group.key} className="flex flex-col gap-2">
                  <h3 className="text-sm font-medium capitalize text-text-secondary">{formatDayHeading(group.posts[0].scheduled_at)}</h3>
                  <PostList posts={group.posts} clockOnly />
                </div>
              ))}
            </div>
          )}
        </Section>

        {published.length > 0 && (
          <Section title={range ? `Publicados em ${formatRange(range)}` : `Publicados nos últimos ${HISTORY_DAYS} dias`} count={published.length}>
            <PostList posts={published} />
          </Section>
        )}
        </div>

        <Composer assets={assets} accounts={accounts} />
      </div>
    </>
  );
}

function WeekLink({ href, label, children }: { href: string; label: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      aria-label={label}
      className="grid h-11 w-11 place-items-center rounded-[var(--radius-button)] border border-border text-text transition-colors duration-[var(--motion-fast)] hover:border-border-strong"
    >
      {children}
    </Link>
  );
}

const CHIP = {
  published: { label: "Publicado", color: "var(--success)", bg: "var(--success-soft)" },
  failed: { label: "Com erro", color: "var(--danger)", bg: "var(--danger-soft)" },
  processing: { label: "Publicando", color: "var(--signal)", bg: "var(--signal-soft)" },
  scheduled: { label: "Agendado", color: "var(--signal)", bg: "var(--signal-soft)" },
} as const;

/** Uma linha por perfil, uma coluna por dia: dia vazio aparece vazio, é assim que a cadência furada fica visível. */
function WeekGrid({ week, accounts, posts, todayKey }: { week: WeekDay[]; accounts: { id: string; username: string | null }[]; posts: PostRow[]; todayKey: string }) {
  const columns = "136px repeat(7, minmax(0, 1fr))";
  return (
    <section className="overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1" aria-label="Grade da semana">
      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid border-b border-border-subtle" style={{ gridTemplateColumns: columns }}>
            <span />
            {week.map((d) => (
              <div key={d.key} className="border-l border-border-subtle px-2 py-3">
                <p className="text-xs text-text-muted">{d.weekday}</p>
                <p className={`text-xl font-semibold tabular-nums ${d.key === todayKey ? "text-signal" : "text-text"}`}>{d.day}</p>
              </div>
            ))}
          </div>
          {accounts.length === 0 && <p className="px-5 py-6 text-sm text-text-muted">Nenhuma conta conectada.</p>}
          {accounts.map((account) => (
            <div key={account.id} className="grid min-h-[112px] border-b border-border-subtle last:border-b-0" style={{ gridTemplateColumns: columns }}>
              <div className="flex min-w-0 flex-col gap-2 px-3 py-3">
                <AccountTile username={account.username} />
                <span className="truncate text-xs font-semibold text-text" title={account.username ? `@${account.username}` : undefined}>
                  {account.username ?? "sem username"}
                </span>
              </div>
              {week.map((d) => (
                <div key={d.key} className="flex min-w-0 flex-col gap-1.5 border-l border-border-subtle p-1.5">
                  {posts
                    .filter((p) => p.social_account_id === account.id && dayKey(p.scheduled_at) === d.key)
                    .map((post) => (
                      <GridChip key={post.id} post={post} />
                    ))}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-5 border-t border-border-subtle px-5 py-3 text-xs text-text-secondary">
        {[CHIP.published, CHIP.scheduled, CHIP.failed].map((c) => (
          <span key={c.label} className="flex items-center gap-2">
            <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[3px]" style={{ background: c.color }} />
            {c.label}
          </span>
        ))}
      </div>
    </section>
  );
}

function GridChip({ post }: { post: PostRow }) {
  const chip = CHIP[post.status as keyof typeof CHIP] ?? CHIP.scheduled;
  const body = (
    <>
      <span className="block break-words text-xs font-semibold leading-tight" style={{ color: chip.color }}>
        {post.media_type === "REELS" ? "Reel" : "Story"} {formatClock(post.scheduled_at)}
      </span>
      <span className="block break-words text-xs leading-tight text-text-secondary">{chip.label}</span>
    </>
  );
  const className = "block rounded-[9px] border px-2 py-1.5";
  const style = { background: chip.bg, borderColor: chip.color };
  return post.permalink ? (
    <a href={post.permalink} target="_blank" rel="noreferrer" className={className} style={style}>
      {body}
    </a>
  ) : (
    <div className={className} style={style} title={post.caption ?? undefined}>
      {body}
    </div>
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
      <h2 className="text-lg font-semibold text-text">
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
          <AccountTile username={post.account?.username} />
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
      ? { label: "Publicado", color: "var(--success)" }
      : status === "processing"
        ? { label: "Publicando", color: "var(--warning)" }
        : status === "failed"
          ? { label: "Erro", color: "var(--danger)" }
          : { label: "Agendado", color: "var(--signal)" };
  return (
    <span className="hidden shrink-0 items-center gap-1.5 text-sm sm:inline-flex" style={{ color: config.color }}>
      <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ background: config.color }} />
      {config.label}
    </span>
  );
}
