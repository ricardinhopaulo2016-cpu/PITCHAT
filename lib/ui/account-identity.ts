/**
 * Identidade visual de uma conta: sigla e cor derivadas do próprio username,
 * sem nenhum nome de perfil no código. Paleta de mesma intensidade, sempre com
 * texto escuro em cima, e a sigla garante que a cor nunca é o único sinal.
 */
const PALETTE = [
  "#8FB8F0",
  "#6FD3CF",
  "#C7D97A",
  "#E7C98A",
  "#E59CC4",
  "#F09A7A",
  "#A9C4D6",
  "#7FD1A0",
  "#D7A9E8",
  "#B9A6F2",
] as const;

export type AccountIdentity = { initials: string; color: string };

function hash(value: string): number {
  let result = 0;
  for (const char of value) result = (result * 31 + char.charCodeAt(0)) >>> 0;
  return result;
}

export function accountIdentity(username: string | null | undefined): AccountIdentity {
  const clean = (username ?? "").replace(/[^\p{L}\p{N}]/gu, "");
  if (!clean) return { initials: "?", color: "#A0A0AA" };
  const initials = clean.charAt(0).toUpperCase() + clean.charAt(1).toLowerCase();
  return { initials, color: PALETTE[hash(username as string) % PALETTE.length] };
}
