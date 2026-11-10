/**
 * Post e envio que pararam no meio do caminho.
 *
 * Post: o motor confere o container a cada poucos minutos e desiste sozinho
 * (PROCESSING_TIMEOUT). Se ele continua "Publicando" muito depois do horário,
 * alguma mensagem da fila se perdeu e ninguém vai mexer nele: precisa de alerta.
 *
 * Mídia: o navegador cria a linha (pending) antes de mandar o arquivo. Se a aba
 * fecha ou a rede cai, o arquivo nunca chega e a linha fica "Processando" para
 * sempre. Depois de um tempo, isso é um envio que não terminou.
 */

export const STUCK_PROCESSING_MS = 30 * 60_000;
export const STALE_UPLOAD_MS = 60 * 60_000;

export function isStuckProcessing(post: { status: string; scheduled_at: string }, now: Date): boolean {
  if (post.status !== "processing") return false;
  return now.getTime() - new Date(post.scheduled_at).getTime() > STUCK_PROCESSING_MS;
}

export function isStaleUpload(asset: { status: string; created_at: string }, now: Date): boolean {
  if (asset.status !== "pending" && asset.status !== "processing") return false;
  return now.getTime() - new Date(asset.created_at).getTime() > STALE_UPLOAD_MS;
}
