import type { SVGProps } from "react";

/**
 * Automations. PROIBIDO raio (⚡) — ver docs/PITCHAT_DESIGN_SYSTEM.md §13.
 * ● trigger (círculo aberto — esperando detectar) │ ◆ lógica (losango
 * preenchido) │ ● ação (círculo preenchido — já executou). Esse símbolo
 * nasce do próprio motor de automação do produto.
 */
export function FlowIcon(props: SVGProps<SVGSVGElement>) {
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
      <circle cx="9" cy="3" r="1.9" />
      <line x1="9" y1="5.3" x2="9" y2="6.6" />
      <path d="M9 6.6 L11.4 9 L9 11.4 L6.6 9 Z" fill="currentColor" stroke="none" />
      <line x1="9" y1="11.4" x2="9" y2="12.7" />
      <circle cx="9" cy="15" r="1.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
