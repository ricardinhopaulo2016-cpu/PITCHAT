import { initials } from "@/lib/ui/format";

const SIZE = {
  sm: "h-6 w-6 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
} as const;

/**
 * Avatar circular do contato. Lê `contacts.avatar_url` quando existir; sem
 * ele, cai pra iniciais do username real. Nenhuma rotina de enrichment
 * existe hoje (a Meta não entrega foto de perfil de forma documentada aqui),
 * então na prática todo mundo usa o fallback — sem URL inventada.
 */
export function ContactAvatar({
  username,
  avatarUrl,
  size = "md",
}: {
  username: string | null;
  avatarUrl?: string | null;
  size?: keyof typeof SIZE;
}) {
  const cls = `inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-border-subtle bg-surface-3 font-medium text-text-secondary ${SIZE[size]}`;
  if (avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- URL externa arbitrária (CDN da Meta), sem domínio fixo pra next/image
      <img src={avatarUrl} alt="" className={`${cls} object-cover`} loading="lazy" />
    );
  }
  return (
    <span className={cls} aria-hidden="true">
      {initials(username)}
    </span>
  );
}
