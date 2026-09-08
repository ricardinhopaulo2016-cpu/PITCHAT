import Link from "next/link";
import { redirect } from "next/navigation";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { getCurrentWorkspace } from "@/lib/workspace";
import { LogoutButton } from "./logout-button";

export default async function DashboardPage() {
  const supabase = await getSupabaseServerClient();
  if (!supabase) redirect("/setup");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const workspace = await getCurrentWorkspace(user.id);

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">PITCHAT</h1>
        <LogoutButton />
      </div>

      {workspace ? (
        <>
          <p>
            Logado como <strong>{user.email}</strong> no workspace{" "}
            <strong>{workspace.name}</strong>.
          </p>
          <p className="mt-4">
            <Link href="/dashboard/media" className="underline">
              Media Library →
            </Link>
          </p>
        </>
      ) : (
        <p className="text-sm opacity-80">
          Seu usuário ({user.email}) ainda não pertence a nenhum workspace. Crie um
          registro em <code>workspace_members</code> (ver{" "}
          <code>supabase/schema.sql</code>) apontando pro seu <code>auth.users.id</code>.
        </p>
      )}

      <p className="mt-6 text-sm opacity-60">
        Fase 1 (fundação) em andamento — Profiles, Social Accounts, Automations, Inbox e
        Media Library chegam nas próximas fases (ver{" "}
        <code>docs/PITCHAT_ARCHITECTURE.md</code>).
      </p>
    </main>
  );
}
