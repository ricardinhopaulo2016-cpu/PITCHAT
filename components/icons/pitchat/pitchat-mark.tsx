import type { SVGProps } from "react";

/**
 * O símbolo do PITCHAT: P + balão de conversa numa única leitura.
 * A haste do P vira a cauda do balão (canto inferior-esquerdo); o "bowl" do P
 * é o próprio corpo arredondado do balão. currentColor, sem gradient — ver
 * docs/PITCHAT_BRAND.md §1-2. Funciona em 16px (2 formas só) e 512px.
 */
export function PitchatMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
      <path d="M9 6H20A4 4 0 0 1 24 10V13A4 4 0 0 1 20 17H9V6Z" fill="currentColor" />
      <rect x="9" y="6" width="5" height="21" rx="2.5" fill="currentColor" />
      <path d="M9 22L3.2 27.8L9 26V22Z" fill="currentColor" />
    </svg>
  );
}

/** Wordmark — parte da IBM Plex Sans 600, tracking reduzido. Nunca solto sem o símbolo na primeira aparição da tela (ver docs/PITCHAT_BRAND.md §3). */
export function PitchatWordmark({ className, ...rest }: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={`font-semibold tracking-[-0.01em] ${className ?? ""}`}
      style={{ fontFamily: "var(--font-sans)" }}
      {...rest}
    >
      PITCHAT
    </span>
  );
}
