import type { SVGProps } from "react";

/** Publicar: uma peça saindo para o calendário, não o avião de papel genérico de "enviar". */
export function PublishIcon(props: SVGProps<SVGSVGElement>) {
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
      <rect x="3" y="4" width="12" height="11" rx="2" />
      <path d="M3 8h12M6.5 2.5v3M11.5 2.5v3" />
      <path d="M9 13.2v-3M7.6 11.4 9 10l1.4 1.4" />
    </svg>
  );
}
