import type { SVGProps } from "react";

/**
 * Social Accounts. Dois sinais conectados — não o logo do Instagram (que só
 * aparece dentro da tela da conta). Círculo aberto = canal externo, círculo
 * preenchido = conta sua conectada. Ver docs/PITCHAT_BRAND.md §6.
 */
export function ChannelIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 18 18"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...props}
    >
      <circle cx="4" cy="9" r="2.4" />
      <line x1="6.6" y1="9" x2="9.4" y2="9" />
      <line x1="11.6" y1="9" x2="12.6" y2="9" />
      <circle cx="14" cy="9" r="2.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
