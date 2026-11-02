import type { PublishError } from "./engine";

const MESSAGES: Record<string, string> = {
  MISSED_WINDOW: "O horário passou há mais de 2 horas sem publicar. Nada foi postado.",
  ACCOUNT_NOT_CONNECTED: "A conta não está conectada. Reconecte e tente de novo.",
  MEDIA_NOT_FOUND: "O arquivo não foi encontrado na biblioteca.",
  PROCESSING_TIMEOUT: "A Meta não terminou de processar o vídeo a tempo.",
  CONTAINER_EXPIRED: "O envio expirou na Meta antes de publicar.",
  CONTAINER_ERROR: "A Meta recusou o arquivo. Confira o formato do vídeo.",
  QUEUE_FAILED: "Não foi possível colocar o post na fila.",
};

/** Mensagem para o operador. O detalhe da Meta vai junto porque é o que permite agir sobre o erro. */
export function friendlyPublishError(error: PublishError | null | undefined): string {
  if (!error) return "Erro desconhecido.";
  const base = MESSAGES[error.reason];
  if (base) return error.message ? `${base} (${error.message})` : base;
  return error.message ?? "Erro desconhecido.";
}
