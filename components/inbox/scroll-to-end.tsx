"use client";

import { useEffect, useRef } from "react";

/**
 * Leva a thread até a atividade mais recente ao abrir uma conversa ou
 * quando chega entrada nova — sem isso, uma conversa longa abriria no
 * primeiro comentário, longe do que precisa de resposta. Scroll instantâneo
 * (sem smooth): respeita prefers-reduced-motion por construção.
 */
export function ScrollToEnd({ trigger }: { trigger: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: "end" });
  }, [trigger]);
  return <div ref={ref} aria-hidden="true" />;
}
