const REQUIRED_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_URL",
  "SUPABASE_SECRET_KEY",
  "PITCHAT_ALLOWED_EMAILS",
];

export default function SetupPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 px-6 py-12">
      <h1 className="text-2xl font-semibold">PITCHAT ainda não está configurado</h1>
      <p className="text-sm opacity-80">
        Falta criar o projeto Supabase (isolado do PitBrain) e preencher{" "}
        <code>.env.local</code>. Veja <code>.env.example</code> e{" "}
        <code>docs/PITCHAT_ARCHITECTURE.md</code> para o passo a passo completo.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-sm">
        {REQUIRED_VARS.map((name) => (
          <li key={name}>
            <code>{name}</code>
          </li>
        ))}
      </ul>
    </main>
  );
}
