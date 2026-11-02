import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/app-shell/page-header";
import { AccountTile } from "@/components/ui/account-tile";
import { formatPostTime } from "./publishing/format";

/** A meta da operação: 1.000 comentários EU QUERO por post. */
const GOAL = 1000;
const GOAL_PHRASE = "eu quero";
const TOP_POSTS = 4;
const DAY_MS = 24 * 60 * 60_000;

type AccountRow = { id: string; username: string | null; status: string; profile_id: string };
type AutomationRow = { id: string; name: string; status: string; profile_id: string; social_account_id: string | null };
type RunRow = { automation_id: string; status: string };
type PostRow = { social_account_id: string; scheduled_at: string; published_at: string | null; status: string; external_media_id: string | null; permalink: string | null };
type CountRow = { external_media_id: string; social_account_id: string; matched: number; total: number };

const number = new Intl.NumberFormat("pt-BR");

function windowFromNow() {
  const now = Date.now();
  return { weekAgo: new Date(now - 7 * DAY_MS).toISOString(), nowIso: new Date(now).toISOString(), weekAhead: new Date(now + 7 * DAY_MS).toISOString() };
}

function plural(count: number, one: string, many: string) {
  return `${number.format(count)} ${count === 1 ? one : many}`;
}

function handles(accounts: AccountRow[]) {
  return accounts.map((a) => (a.username ? `@${a.username}` : "conta sem username")).join(", ");
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ channel?: string }> }) {
  const { channel } = await searchParams;

  const auth = await getAuthContext();
  if (!auth) redirect("/login");

  const admin = getSupabaseAdminClient();
  if (!admin) redirect("/setup");

  const { weekAgo, nowIso, weekAhead } = windowFromNow();
  const workspaceId = auth.workspace.id;

  const [{ data: accountRows }, { data: automationRows }, { count: failedRuns }, { data: postRows }, { data: countRows }] = await Promise.all([
    admin
      .from("social_accounts")
      .select("id, username, status, profile_id")
      .eq("workspace_id", workspaceId)
      .eq("platform", "instagram")
      .neq("status", "revoked")
      .order("created_at", { ascending: true })
      .returns<AccountRow[]>(),
    admin.from("automations").select("id, name, status, profile_id, social_account_id").eq("workspace_id", workspaceId).returns<AutomationRow[]>(),
    admin.from("automation_runs").select("id", { count: "exact", head: true }).eq("workspace_id", workspaceId).eq("status", "failed").gte("started_at", weekAgo),
    admin
      .from("scheduled_posts")
      .select("social_account_id, scheduled_at, published_at, status, external_media_id, permalink")
      .eq("workspace_id", workspaceId)
      .neq("status", "canceled")
      .order("scheduled_at", { ascending: false })
      .limit(500)
      .returns<PostRow[]>(),
    admin.rpc("post_comment_counts", { p_workspace_id: workspaceId, p_phrase: GOAL_PHRASE, p_limit: 40 }),
  ]);

  const allAccounts = accountRows ?? [];
  const accounts = channel ? allAccounts.filter((a) => a.id === channel) : allAccounts;
  const accountIds = new Set(accounts.map((a) => a.id));
  const accountById = new Map(allAccounts.map((a) => [a.id, a]));
  const automations = automationRows ?? [];
  const activeAutomations = automations.filter((a) => a.status === "active");
  const posts = (postRows ?? []).filter((p) => accountIds.has(p.social_account_id));

  const automationIds = automations.map((a) => a.id);
  const { data: runRows } = automationIds.length
    ? await admin.from("automation_runs").select("automation_id, status").in("automation_id", automationIds).limit(1000).returns<RunRow[]>()
    : { data: [] as RunRow[] };
  const runsByAutomation = new Map<string, number>();
  for (const run of runRows ?? []) runsByAutomation.set(run.automation_id, (runsByAutomation.get(run.automation_id) ?? 0) + 1);

  const permalinkByMedia = new Map(posts.filter((p) => p.external_media_id && p.permalink).map((p) => [p.external_media_id as string, p.permalink as string]));
  const counts = ((countRows as CountRow[] | null) ?? [])
    .filter((c) => accountIds.has(c.social_account_id))
    .map((c) => ({ ...c, matched: Number(c.matched), total: Number(c.total) }));
  const topPosts = counts.filter((c) => c.matched > 0).slice(0, TOP_POSTS);
  const best = topPosts[0]?.matched ?? 0;
  const matchedByAccount = new Map<string, number>();
  for (const c of counts) matchedByAccount.set(c.social_account_id, (matchedByAccount.get(c.social_account_id) ?? 0) + c.matched);

  const rows = accounts.map((account) => {
    const own = activeAutomations.filter((a) => a.social_account_id === account.id || (!a.social_account_id && a.profile_id === account.profile_id));
    const specific = own.filter((a) => a.social_account_id === account.id);
    const runs = (specific.length ? specific : own).reduce((sum, a) => sum + (runsByAutomation.get(a.id) ?? 0), 0);
    const accountPosts = posts.filter((p) => p.social_account_id === account.id);
    const next = accountPosts.filter((p) => p.status === "scheduled" && p.scheduled_at >= nowIso).at(-1);
    const last = accountPosts.find((p) => p.status === "published");
    return { account, hasAutomation: own.length > 0, runs, next, last, matched: matchedByAccount.get(account.id) ?? 0 };
  });

  const upcoming = posts.filter((p) => p.status === "scheduled" && p.scheduled_at >= nowIso && p.scheduled_at <= weekAhead).length;
  const failedPosts = posts.filter((p) => p.status === "failed").length;
  const disconnected = accounts.filter((a) => a.status !== "connected");
  const untested = rows.filter((r) => r.hasAutomation && r.runs === 0).map((r) => r.account);
  const connected = accounts.length - disconnected.length;

  const tasks: { title: string; detail: string; href: string }[] = [];
  if (failedPosts > 0) tasks.push({ title: plural(failedPosts, "post com erro", "posts com erro"), detail: "Veja o motivo e tente de novo", href: "/dashboard/publishing" });
  if (disconnected.length > 0) tasks.push({ title: "Reconectar contas", detail: handles(disconnected), href: "/dashboard/social-accounts" });
  if ((failedRuns ?? 0) > 0) tasks.push({ title: plural(failedRuns ?? 0, "falha de automação", "falhas de automação"), detail: "Nos últimos 7 dias", href: "/dashboard/health" });
  if (untested.length > 0) tasks.push({ title: "Testar o EU QUERO com comentário real", detail: handles(untested), href: "/dashboard/automations" });
  if (upcoming === 0) tasks.push({ title: "Nada agendado", detail: "Nenhum post nos próximos 7 dias", href: "/dashboard/publishing" });

  return (
    <>
      <PageHeader
        title="Visão geral"
        description={`${plural(connected, "conta conectada", "contas conectadas")}, ${plural(activeAutomations.length, "automação ativa", "automações ativas")}, ${plural(upcoming, "post agendado", "posts agendados")} nos próximos 7 dias.`}
        action={
          <Link
            href="/dashboard/publishing"
            className="inline-flex h-11 items-center rounded-[var(--radius-button)] bg-signal px-5 font-semibold text-signal-on transition-colors duration-[var(--motion-fast)] hover:bg-signal-hover"
          >
            Novo post
          </Link>
        }
      />

      <div className="flex flex-col gap-4 px-6 pb-14 md:px-11">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <section className="flex flex-col gap-6 rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-7">
            <div className="flex items-baseline justify-between gap-3">
              <h2 className="text-lg font-semibold text-text">Rumo aos {number.format(GOAL)} por post</h2>
              <span className="text-xs text-text-muted">Comentários recebidos pelo PITCHAT</span>
            </div>
            <div>
              <p className="text-[72px] font-semibold leading-none tracking-[-0.04em] text-signal">{number.format(best)}</p>
              <p className="mt-2.5 text-text-secondary">EU QUERO no melhor post</p>
            </div>
            {topPosts.length === 0 ? (
              <p className="text-sm text-text-muted">Assim que alguém comentar EU QUERO num post, ele aparece aqui.</p>
            ) : (
              <ul className="flex flex-col gap-4">
                {topPosts.map((post) => {
                  const account = accountById.get(post.social_account_id);
                  const permalink = permalinkByMedia.get(post.external_media_id);
                  const label = `@${account?.username ?? "conta"}, post ${post.external_media_id.slice(-5)}`;
                  return (
                    <li key={`${post.social_account_id}-${post.external_media_id}`}>
                      <div className="mb-1.5 flex justify-between gap-3 text-sm">
                        {permalink ? (
                          <a href={permalink} target="_blank" rel="noreferrer" className="truncate text-text-secondary underline hover:text-text">
                            {label}
                          </a>
                        ) : (
                          <span className="truncate text-text-secondary">{label}</span>
                        )}
                        <span className="shrink-0 text-text">{number.format(post.matched)}</span>
                      </div>
                      <div className="h-2 rounded bg-surface-3">
                        <div className="h-2 min-w-1 rounded bg-signal" style={{ width: `${Math.min(100, (post.matched / GOAL) * 100)}%` }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="flex flex-col rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1 p-7">
            <h2 className="mb-3 text-lg font-semibold text-text">Precisa de você</h2>
            {tasks.length === 0 ? (
              <p className="border-t border-border-subtle pt-4 text-sm text-text-muted">Nada pendente agora.</p>
            ) : (
              <ul>
                {tasks.map((task) => (
                  <li key={task.title} className="border-t border-border-subtle">
                    <Link href={task.href} className="group flex items-center justify-between gap-4 py-3.5">
                      <span className="min-w-0">
                        <span className="block font-medium text-text">{task.title}</span>
                        <span className="block truncate text-sm text-text-secondary">{task.detail}</span>
                      </span>
                      <ChevronRight className="h-[18px] w-[18px] shrink-0 text-text-muted transition-colors duration-[var(--motion-fast)] group-hover:text-text" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
          <div className="flex items-center justify-between px-7 py-5">
            <h2 className="text-lg font-semibold text-text">Perfis</h2>
            <Link href="/dashboard/social-accounts" className="text-sm text-text-secondary hover:text-text">
              Gerenciar contas
            </Link>
          </div>
          {rows.length === 0 ? (
            <p className="border-t border-border-subtle px-7 py-6 text-sm text-text-muted">Nenhuma conta conectada.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-left">
                <thead>
                  <tr className="border-t border-border-subtle text-xs text-text-muted">
                    <th className="px-7 py-2.5 font-normal">Perfil</th>
                    <th className="px-3 py-2.5 font-normal">Automação</th>
                    <th className="px-3 py-2.5 text-right font-normal">Disparos</th>
                    <th className="px-3 py-2.5 text-right font-normal">EU QUERO</th>
                    <th className="px-3 py-2.5 font-normal">Próximo post</th>
                    <th className="px-7 py-2.5 font-normal">Último pelo PITCHAT</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ account, hasAutomation, runs, next, last, matched }) => {
                    const status = !hasAutomation
                      ? { label: "Sem automação ativa", color: "var(--text-muted)" }
                      : runs === 0
                        ? { label: "Ativa, sem disparo ainda", color: "var(--warning)" }
                        : { label: "Ativa e rodando", color: "var(--success)" };
                    return (
                      <tr key={account.id} className="h-16 border-t border-border-subtle">
                        <td className="px-7">
                          <span className="flex items-center gap-3">
                            <AccountTile username={account.username} size="lg" />
                            <span className="font-semibold text-text">@{account.username ?? "sem username"}</span>
                          </span>
                        </td>
                        <td className="px-3">
                          <span className="inline-flex items-center gap-2 text-sm" style={{ color: status.color }}>
                            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full" style={{ background: status.color }} />
                            {status.label}
                          </span>
                        </td>
                        <td className="px-3 text-right text-text">{number.format(runs)}</td>
                        <td className="px-3 text-right text-text">{number.format(matched)}</td>
                        <td className="px-3 text-sm text-text-secondary">{next ? formatPostTime(next.scheduled_at) : "Nada agendado"}</td>
                        <td className="px-7 text-sm text-text-secondary">{last ? formatPostTime(last.published_at ?? last.scheduled_at) : "Nenhum ainda"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
