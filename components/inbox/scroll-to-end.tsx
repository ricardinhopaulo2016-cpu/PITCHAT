"use client";

import { useEffect, useRef } from "react";
import { isNearScrollEnd } from "@/lib/inbox/view";

function scrollParentOf(element: HTMLElement): HTMLElement | null {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
}

/**
 * Leva a thread até a atividade mais recente ao abrir uma conversa (a página
 * remonta a timeline por conversa) e quando chega entrada nova, mas só se o
 * operador já estava no fim: quem rolou para reler não perde o ponto. Rola só
 * a coluna da thread, nunca a janela. Scroll instantâneo (sem smooth): respeita
 * prefers-reduced-motion por construção.
 */
export function ScrollToEnd({ trigger }: { trigger: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Atualizado no evento de scroll: guarda a posição de ANTES da entrada nova
  // crescer a thread. Medir depois do render daria sempre "longe do fim".
  const followingRef = useRef(true);

  useEffect(() => {
    const parent = ref.current && scrollParentOf(ref.current);
    if (!parent) return;
    const update = () => {
      followingRef.current = isNearScrollEnd(parent);
    };
    parent.addEventListener("scroll", update, { passive: true });
    return () => parent.removeEventListener("scroll", update);
  }, []);

  useEffect(() => {
    const parent = ref.current && scrollParentOf(ref.current);
    if (parent && followingRef.current) parent.scrollTo({ top: parent.scrollHeight });
  }, [trigger]);

  return <div ref={ref} aria-hidden="true" />;
}
