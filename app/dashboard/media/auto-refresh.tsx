"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Polling leve: enquanto existir alguma mídia pending/processing na página,
 * recarrega os dados do servidor a cada poucos segundos, pra quem tá vendo
 * a lista não precisar dar F5 pra saber quando terminou. Sem realtime/
 * websocket — o suficiente pro volume e arquitetura atuais.
 */
export function AutoRefreshWhilePending({ active }: { active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(interval);
  }, [active, router]);

  return null;
}
