"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { PitchatMark, PitchatWordmark, SignalMarker } from "@/components/icons/pitchat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

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
    <main className="flex min-h-screen bg-bg">
      {/* Esquerda: presença de marca, sem landing page dentro do login (docs/PITCHAT_DESIGN_SYSTEM.md, seção 32 do briefing) */}
      <div className="hidden w-1/2 flex-col justify-between border-r border-border-subtle bg-bg-sidebar px-14 py-14 lg:flex">
        <div className="flex items-center gap-2.5">
          <PitchatMark className="h-7 w-7 text-signal" />
          <PitchatWordmark className="text-xl text-text" />
        </div>

        <div className="flex flex-col gap-3 text-sm text-text-secondary">
          <div className="flex items-center gap-2.5">
            <SignalMarker type="trigger" />
            <span>message</span>
          </div>
          <div className="ml-[7px] h-4 w-px bg-border" />
          <div className="flex items-center gap-2.5">
            <SignalMarker type="logic" />
            <span>keyword</span>
          </div>
          <div className="ml-[7px] h-4 w-px bg-border" />
          <div className="flex items-center gap-2.5">
            <SignalMarker type="action" active />
            <span className="text-text">reply</span>
          </div>
        </div>

        <p className="text-xs text-text-muted">Automação de Instagram operada como ferramenta.</p>
      </div>

      {/* Direita: form */}
      <div className="flex w-full flex-1 flex-col justify-center px-8 lg:w-1/2 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <PitchatMark className="h-6 w-6 text-signal" />
            <PitchatWordmark className="text-lg text-text" />
          </div>

          <h1 className="text-xl font-semibold text-text">Entrar no PITCHAT</h1>

          {urlError === "unauthorized" && (
            <p className="mt-4 rounded-[var(--radius-panel-sm)] border border-danger bg-danger-soft px-3.5 py-2.5 text-sm text-text">
              Este e-mail não tem permissão para acessar o PITCHAT.
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="email" className="text-xs text-text-muted">
                E-mail
              </label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="password" className="text-xs text-text-muted">
                Senha
              </label>
              <Input
                id="password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="text-sm text-danger">{error}</p>}
            <Button type="submit" variant="primary" disabled={loading} className="mt-1 w-full">
              {loading ? "Entrando…" : "Entrar"}
            </Button>
          </form>

          <p className="mt-6 text-xs text-text-muted">
            Cadastro público desativado. Usuário criado manualmente no Supabase Auth, e-mail liberado em{" "}
            <code className="font-mono">PITCHAT_ALLOWED_EMAILS</code>.
          </p>
        </div>
      </div>
    </main>
  );
}
