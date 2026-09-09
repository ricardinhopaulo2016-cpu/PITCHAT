import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Criptografia simétrica (AES-256-GCM) do access_token do Instagram antes de
 * gravar em social_accounts.access_token_encrypted — a coluna se chama assim
 * por um motivo, não é só um nome. Chave derivada de META_TOKEN_ENCRYPTION_KEY
 * (32+ bytes de entropia, gerar com `openssl rand -base64 32`).
 *
 * Formato armazenado: "<iv_hex>:<authTag_hex>:<ciphertext_hex>".
 */

function getKey(): Buffer {
  const secret = process.env.META_TOKEN_ENCRYPTION_KEY;
  if (!secret) {
    throw new Error(
      "META_TOKEN_ENCRYPTION_KEY não configurado — necessário pra criptografar/descriptografar tokens do Instagram."
    );
  }
  // scrypt deriva uma chave de 32 bytes de qualquer secret, mesmo que ele
  // não tenha exatamente 32 bytes — salt fixo é aceitável aqui porque a
  // "senha" já é um secret de alta entropia gerado por nós, não escolhido
  // por usuário (não é um cenário de senha fraca + rainbow table).
  return scryptSync(secret, "pitchat-meta-token", 32);
}

export function encryptToken(plainToken: string): string {
  const key = getKey();
  const iv = randomBytes(12); // GCM recomenda IV de 12 bytes
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainToken, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(stored: string): string {
  const [ivHex, authTagHex, dataHex] = stored.split(":");
  if (!ivHex || !authTagHex || !dataHex) {
    throw new Error("Formato inválido de token criptografado");
  }
  const key = getKey();
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
