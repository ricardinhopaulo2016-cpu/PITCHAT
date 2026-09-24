import type { SVGProps } from "react";

/**
 * Health Dashboard. Nasce do conceito "Pulse" já nomeado em
 * docs/PITCHAT_DESIGN_SYSTEM.md §2 ("evento acontecendo agora") — uma linha
 * de sinal/EKG, não um coração/cruz médica genérica nem `Activity` do Lucide.
 */
export function PulseIcon(props: SVGProps<SVGSVGElement>) {
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
      <path d="M2 9.5h3l1.5-4.5L9 14l2-9 1.5 4.5H16" />
    </svg>
  );
}
