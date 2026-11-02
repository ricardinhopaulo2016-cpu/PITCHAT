"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { PitchatMark, PitchatWordmark } from "@/components/icons/pitchat";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

/** A mensagem que o Supabase devolve para credencial errada, em português. */
function friendlyAuthError(message: string): string {
  return message === "Invalid login credentials" ? "E-mail ou senha incorretos." : message;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
        setError("O acesso ainda não está configurado.");
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
        setError(friendlyAuthError(result.error.message));
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      if (raw === "TIMEOUT_15S") {
        setError(`O servidor não respondeu em ${SIGN_IN_TIMEOUT_MS / 1000}s. Verifique sua conexão e tente de novo.`);
      } else {
        // Nunca esconder a mensagem real: só avisa que foi falha de conexão, não credencial rejeitada.
        setError(`Não foi possível conectar: ${raw}`);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-bg">
      <div className="flex w-full flex-col px-8 py-10 lg:w-[46%] lg:px-16">
        <div className="flex items-center gap-2.5">
          <PitchatMark className="h-7 w-7 text-signal" />
          <PitchatWordmark className="text-lg text-text" />
        </div>

        <div className="my-auto w-full max-w-[400px] self-center py-12">
          <h1 className="text-[36px] font-semibold leading-[1.1] tracking-[-0.025em] text-text">Bem-vindo de volta</h1>
          <p className="mt-2 text-base text-text-secondary">Entre para cuidar dos seus perfis.</p>

          {urlError === "unauthorized" && (
            <p className="mt-6 rounded-[var(--radius-panel-sm)] border border-danger bg-danger-soft px-3.5 py-2.5 text-sm text-text">
              Este e-mail não tem permissão para acessar o PITCHAT.
            </p>
          )}

          <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-sm font-medium text-text">
                E-mail
              </label>
              <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-12" />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-sm font-medium text-text">
                Senha
              </label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-12 pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Esconder senha" : "Mostrar senha"}
                  aria-pressed={showPassword}
                  className="absolute right-1 top-1 grid h-10 w-10 place-items-center rounded-[8px] text-text-muted transition-colors duration-[var(--motion-fast)] hover:text-text"
                >
                  {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                </button>
              </div>
            </div>
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={loading} className="mt-1 h-12 w-full">
              {loading ? "Entrando…" : "Entrar"}
            </Button>
          </form>
        </div>

        <p className="text-xs text-text-muted">Acesso restrito à equipe.</p>
      </div>

      <FlowPreview />
    </main>
  );
}

/** O que o produto faz, mostrado em vez de explicado. Ilustração estática: nenhum dado real. */
function FlowPreview() {
  return (
    <aside className="hidden flex-1 flex-col justify-center gap-12 border-l border-border-subtle bg-bg-sidebar px-16 py-14 lg:flex" aria-hidden="true">
      <div className="max-w-[520px] self-center">
        <p className="text-[44px] font-semibold leading-[1.08] tracking-[-0.03em] text-text">Cada comentário vira uma conversa.</p>
        <p className="mt-4 text-lg text-text-secondary">Publique nos seus perfis, responda quem comenta e acompanhe tudo num lugar só.</p>

        <div className="mt-12 flex flex-col gap-3 rounded-[20px] border border-border-subtle bg-surface-1 p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-surface-3 text-sm font-semibold text-text-secondary">M</span>
            <div className="rounded-[16px_16px_16px_4px] bg-surface-2 px-4 py-2.5">
              <p className="text-xs text-text-muted">Comentou no seu Reel</p>
              <p className="font-semibold text-text">EU QUERO</p>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="w-[300px] max-w-full rounded-[16px_16px_4px_16px] bg-surface-3 px-4 py-3">
              <p className="text-text">Oi! Quer receber o vídeo?</p>
              <p className="mt-2.5 rounded-[10px] border border-border-strong py-2 text-center text-sm font-semibold text-text">Quero receber</p>
            </div>
          </div>

          <div className="flex justify-end">
            <div className="rounded-[16px_16px_4px_16px] bg-signal px-4 py-2.5 font-semibold text-signal-on">Aqui está o seu link</div>
          </div>
        </div>
      </div>
    </aside>
  );
}
