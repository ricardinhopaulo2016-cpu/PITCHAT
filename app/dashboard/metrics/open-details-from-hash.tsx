"use client";

import { useEffect } from "react";

/** Link para `#ancora` dentro de um bloco recolhido: abre o bloco antes de rolar até ele. */
export function OpenDetailsFromHash() {
  useEffect(() => {
    function openTarget() {
      const id = decodeURIComponent(window.location.hash.slice(1));
      const target = id ? document.getElementById(id) : null;
      if (!target) return;
      let opened = false;
      for (let element: HTMLElement | null = target; element; element = element.parentElement) {
        if (element instanceof HTMLDetailsElement && !element.open) {
          element.open = true;
          opened = true;
        }
      }
      if (opened) target.scrollIntoView();
    }
    openTarget();
    window.addEventListener("hashchange", openTarget);
    return () => window.removeEventListener("hashchange", openTarget);
  }, []);
  return null;
}
