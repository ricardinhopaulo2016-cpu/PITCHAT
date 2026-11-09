"use client";

import { useEffect } from "react";

/**
 * Roda `callback` a cada `intervalMs` só com a aba visível. Com a aba oculta
 * não faz nada; ao voltar, roda na hora. `callback` precisa ser estável
 * (useCallback), senão o intervalo reinicia a cada render. Com `intervalMs`
 * null, não roda.
 */
export function useVisibleInterval(callback: () => void, intervalMs: number | null) {
  useEffect(() => {
    if (intervalMs === null) return;
    const delay = intervalMs;
    let timer: ReturnType<typeof setInterval> | null = null;

    function stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }

    function start() {
      stop();
      timer = setInterval(() => {
        if (document.visibilityState === "visible") callback();
      }, delay);
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        callback();
        start();
      } else {
        stop();
      }
    }

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [callback, intervalMs]);
}
