import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { getCurrentWorkspace } from "@/lib/workspace";
import { getMediaStats } from "@/lib/media/stats";
import { LogoutButton } from "./logout-button";

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/setup");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getCurrentWorkspace(user.id);
  const admin = getSupabaseAdminClient();
  const stats =
    workspace && admin ? await getMediaStats(admin, workspace.id) : null;

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">PITCHAT</h1>
        <LogoutButton />
      </div>

      {!workspace ? (
        <p className="text-sm opacity-80">
          Seu usuário ({user.email}) ainda não pertence a nenhum workspace. Fale com
          quem administra o PITCHAT pra ser adicionado.
        </p>
      ) : (
        <>
          <p className="text-sm opacity-70">
            {user.email} · workspace <strong>{workspace.name}</strong>
          </p>

          <div className="mt-6 grid grid-cols-3 gap-4">
            <StatCard label="Mídias prontas" value={stats?.ready ?? "—"} />
            <StatCard label="Processando" value={stats?.processing ?? "—"} />
            <StatCard
              label="Com erro"
              value={stats?.failed ?? "—"}
              tone={stats && stats.failed > 0 ? "warn" : undefined}
            />
          </div>

          <p className="mt-8 flex gap-4">
            <Link href="/dashboard/automations" className="underline">
              Automations →
            </Link>
            <Link href="/dashboard/social-accounts" className="underline">
              Social Accounts →
            </Link>
            <Link href="/dashboard/media" className="underline opacity-60">
              Media Library (congelada) →
            </Link>
          </p>
        </>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number | string;
  tone?: "warn";
}) {
  return (
    <div className="rounded border p-4">
      <div className={`text-2xl font-semibold ${tone === "warn" ? "text-amber-600" : ""}`}>
        {value}
      </div>
      <div className="text-sm opacity-60">{label}</div>
    </div>
  );
}
