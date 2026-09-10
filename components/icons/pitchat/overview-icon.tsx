import type { SVGProps } from "react";

/**
 * Dashboard. Deliberadamente NÃO é um grid 2x2. Uma rail vertical com sinais
 * em posições diferentes — visão geral dos sinais do sistema, não um gráfico
 * financeiro. Ver docs/PITCHAT_BRAND.md §6.
 */
export function OverviewIcon(props: SVGProps<SVGSVGElement>) {
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
      <line x1="5" y1="2.5" x2="5" y2="15.5" />
      <circle cx="5" cy="4.5" r="1.4" fill="currentColor" stroke="none" />
      <line x1="5" y1="9" x2="10.5" y2="9" />
      <circle cx="12" cy="9" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="5" cy="13.5" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}
