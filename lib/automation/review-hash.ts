import type { Graph } from "./graph";

/**
 * Hash do conteúdo exato sendo publicado — base do gate de revisão (B3,
 * auditoria de 24/09/2026: foi possível publicar conteúdo real inadequado
 * sem nenhuma revisão). O cliente calcula esse hash a partir do MESMO grafo
 * mostrado no modal de revisão e manda junto com a confirmação; o servidor
 * recalcula a partir do draft de verdade e compara — se o conteúdo mudou
 * entre abrir o modal e confirmar (outra aba, outra pessoa editando), os
 * hashes não batem e a publicação é recusada, exigindo nova revisão.
 *
 * Usa Web Crypto (`crypto.subtle`) em vez de `node:crypto` de propósito —
 * roda igual em Client Component (browser) e Route Handler (Node 18+ expõe
 * o mesmo `crypto.subtle` global), uma implementação só, sem duplicar lógica
 * nem quebrar o bundle do client component importando um módulo Node-only.
 */
export async function computeGraphReviewHash(graph: Graph): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(graph));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Confirmação só é válida se veio marcada E pro hash exato do conteúdo atual. */
export function isReviewConfirmed(
  input: { confirmed?: unknown; reviewedGraphHash?: unknown },
  expectedHash: string
): boolean {
  return input.confirmed === true && input.reviewedGraphHash === expectedHash;
}
