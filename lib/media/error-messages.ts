/**
 * Traduz códigos de erro técnicos (os mesmos que as Route Handlers retornam)
 * pra mensagem amigável de UI. O erro técnico completo continua indo pro
 * console/log — isso aqui é só o que o operador vê na tela.
 */
const FRIENDLY_MESSAGES: Record<string, string> = {
  FILE_TOO_LARGE: "Esse arquivo é grande demais.",
  INVALID_MIME_TYPE: "O formato desse arquivo não é suportado.",
  INVALID_BODY: "O formato desse arquivo não é suportado.",
  FFPROBE_FAILED: "Não conseguimos processar esse vídeo.",
  FILE_SIZE_INVALID: "Não conseguimos processar esse arquivo.",
  UNAUTHORIZED: "Sua sessão expirou — atualize a página e faça login de novo.",
  SUPABASE_NOT_CONFIGURED: "O sistema ainda não está configurado. Fale com o administrador.",
};

const DEFAULT_MESSAGE = "Não foi possível enviar o arquivo.";

export function friendlyUploadError(code: string | null | undefined): string {
  if (!code) return DEFAULT_MESSAGE;
  return FRIENDLY_MESSAGES[code] ?? DEFAULT_MESSAGE;
}
