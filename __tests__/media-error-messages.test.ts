import { describe, expect, it } from "vitest";
import { friendlyUploadError } from "@/lib/media/error-messages";

describe("friendlyUploadError", () => {
  it("traduz códigos conhecidos pra mensagem amigável", () => {
    expect(friendlyUploadError("INVALID_MIME_TYPE")).toBe(
      "O formato desse arquivo não é suportado."
    );
    expect(friendlyUploadError("FFPROBE_FAILED")).toBe("Não conseguimos processar esse vídeo.");
  });

  it("nunca vaza o código técnico bruto pra tela", () => {
    const message = friendlyUploadError("DB_INSERT_FAILED_WEIRD_CODE_XYZ");
    expect(message).not.toMatch(/DB_INSERT|XYZ/);
  });

  it("tem um fallback genérico pra código desconhecido ou ausente", () => {
    expect(friendlyUploadError("ALGO_NUNCA_VISTO")).toBe("Não foi possível enviar o arquivo.");
    expect(friendlyUploadError(null)).toBe("Não foi possível enviar o arquivo.");
    expect(friendlyUploadError(undefined)).toBe("Não foi possível enviar o arquivo.");
  });
});
