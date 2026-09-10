import type { SVGProps } from "react";

/**
 * Contacts (futuro — "Em breve"). Identidades ligadas por uma thread — não
 * UsersRound genérico. A thread é o que conecta, coerente com o conceito
 * central do produto. Ver docs/PITCHAT_BRAND.md §6.
 */
export function ContactThreadIcon(props: SVGProps<SVGSVGElement>) {
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
      <circle cx="4.5" cy="5" r="2" fill="currentColor" stroke="none" />
      <circle cx="13.5" cy="13" r="2" />
      <path d="M6 6.5C8 9 9.5 9.5 11.8 11.5" strokeDasharray="0.1 3" />
    </svg>
  );
}
