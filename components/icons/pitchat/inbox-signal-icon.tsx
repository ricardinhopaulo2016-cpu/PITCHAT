import type { SVGProps } from "react";

/**
 * Inbox (futuro — "Em breve"). Uma thread entrando por uma área aberta à
 * esquerda de um receptáculo — representa RECEBIMENTO, não um MessageCircle
 * genérico. Ver docs/PITCHAT_BRAND.md §6.
 */
export function InboxSignalIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <path d="M2 9H12" />
      <path d="M12.5 4.5H15.5V13.5H12.5" />
      <circle cx="12" cy="9" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}
