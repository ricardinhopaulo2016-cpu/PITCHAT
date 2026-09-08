/**
 * Allowlist de e-mails autorizados a logar no PITCHAT. Cadastro público está
 * desativado — usuários são criados manualmente no Supabase Auth e o e-mail
 * precisa estar listado em PITCHAT_ALLOWED_EMAILS (separado por vírgula).
 *
 * Mesmo padrão do PitBrain (lib/auth/allowed-emails.ts), mantido isolado
 * porque os dois produtos não compartilham configuração.
 */
export function isEmailAllowed(email: string | null | undefined): boolean {
  if (!email) return false;

  const allowed = (process.env.PITCHAT_ALLOWED_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  // Sem allowlist configurada: nega por padrão (fail closed), nunca abre acesso público.
  if (allowed.length === 0) return false;

  return allowed.includes(email.trim().toLowerCase());
}
