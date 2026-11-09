import { formatUnreadBadge } from "@/lib/ui/format";

/** Bolinha com o número de não lidas. O leitor de tela ouve `label`, com o total real. */
export function UnreadBadge({ count, label, className = "" }: { count: number; label: string; className?: string }) {
  const text = formatUnreadBadge(count);
  if (!text) return null;
  return (
    <span
      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-signal px-1.5 text-[11px] font-semibold leading-none text-signal-on ${className}`}
    >
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
