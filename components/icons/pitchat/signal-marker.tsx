import type { SVGProps } from "react";

export type SignalMarkerType = "trigger" | "logic" | "action" | "wait" | "end" | "error";

/**
 * Família de markers repetida em todo lugar que mostra execução real
 * (editor, activity feed, logs, automation status) — a repetição é o que
 * constrói identidade (docs/PITCHAT_DESIGN_SYSTEM.md §10):
 * trigger ● · lógica/keyword/condition ◆ · wait ‖ · end ■ · error !
 * `active` troca a cor pra --signal (nunca glow/círculo neon).
 */
export function SignalMarker({
  type,
  active,
  ...rest
}: { type: SignalMarkerType; active?: boolean } & SVGProps<SVGSVGElement>) {
  const color = active ? "var(--signal)" : "currentColor";

  return (
    <svg
      viewBox="0 0 14 14"
      width={14}
      height={14}
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      {...rest}
    >
      {type === "trigger" && <circle cx="7" cy="7" r="3.5" fill="none" stroke={color} strokeWidth={1.6} />}
      {type === "action" && <circle cx="7" cy="7" r="3.5" fill={color} />}
      {type === "logic" && <path d="M7 2.5L11.5 7L7 11.5L2.5 7Z" fill={color} />}
      {type === "wait" && (
        <>
          <rect x="4.5" y="2.5" width="1.6" height="9" rx="0.8" fill={color} />
          <rect x="8" y="2.5" width="1.6" height="9" rx="0.8" fill={color} />
        </>
      )}
      {type === "end" && <rect x="3.5" y="3.5" width="7" height="7" rx="1" fill={color} />}
      {type === "error" && (
        <>
          <rect x="6.2" y="2.5" width="1.6" height="5.5" rx="0.8" fill={color} />
          <circle cx="7" cy="10.5" r="1" fill={color} />
        </>
      )}
    </svg>
  );
}
