"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const urlError = searchParams.get("error");
  const redirect = searchParams.get("redirect") ?? "/dashboard";

  const SIGN_IN_TIMEOUT_MS = 15000;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // TUDO fica dentro do try — inclusive getSupabaseBrowserClient() e
    // createBrowserClient() por trás dela. Achado real testando em aba
    // anônima: essas restam FORA do try na versão anterior do fix, e
    // createBrowserClient pode lançar em contextos com storage/cookies
    // restritos (aba anônima, extensão bloqueando) — exatamente o motivo do
    // botão continuar travado mesmo depois do primeiro fix (finally nunca
    // rodava porque a exceção nem chegava a entrar no try). Nunca mais deixar
    // nenhum caminho de exceção fora do try/catch/finally aqui.
    try {
      const supabase = getSupabaseBrowserClient();
      if (!supabase) {
        setError("Supabase não está configurado.");
        return;
      }

      // signInWithPassword normalmente RESOLVE com { error } mesmo pra
      // credencial inválida, mas pode LANÇAR (rede caiu, DNS, etc.) — o
      // timeout cobre o caso em que a promise nem resolve nem rejeita.
      const result = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT_15S")), SIGN_IN_TIMEOUT_MS)
        ),
      ]);

      if (result.error) {
        setError(result.error.message);
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw === "TIMEOUT_15S") {
        setError(
          `O Supabase não respondeu em ${SIGN_IN_TIMEOUT_MS / 1000}s. Verifique sua conexão e tente de novo.`
        );
      } else {
        // Nunca esconder a mensagem real — só adiciona contexto de que foi
        // uma falha de rede/exceção, não uma credencial rejeitada.
        setError(`Falha ao contatar o Supabase: ${raw}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <h1 className="text-2xl font-semibold">PITCHAT</h1>

      {urlError === "unauthorized" && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          Este e-mail não tem permissão para acessar o PITCHAT.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="email"
          required
          placeholder="E-mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border px-3 py-2"
        />
        <input
          type="password"
          required
          placeholder="Senha"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="rounded border px-3 py-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-black px-3 py-2 text-white disabled:opacity-50"
        >
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>

      <p className="text-xs opacity-60">
        Cadastro público desativado. Usuário criado manualmente no Supabase Auth,
        e-mail liberado em <code>PITCHAT_ALLOWED_EMAILS</code>.
      </p>
    </main>
  );
}
