import { createHash, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthContext, type AuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Workspace } from "@/lib/workspace";

/** Prefixo fixo: deixa claro de onde o token veio se ele vazar num log. */
export const API_TOKEN_PREFIX = "pct_";

export function generateApiToken(): string {
  return API_TOKEN_PREFIX + randomBytes(32).toString("base64url");
}

/** O banco só guarda o hash. Token de 256 bits aleatórios não precisa de salt. */
export function hashApiToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  const match = header?.match(/^Bearer\s+(\S+)$/i);
  const token = match?.[1] ?? null;
  return token?.startsWith(API_TOKEN_PREFIX) ? token : null;
}

type TokenRow = {
  id: string;
  created_by: string;
  workspace: Workspace | null;
};

/** Token válido e não revogado vira o mesmo contexto de uma sessão, no workspace do token. */
export async function authenticateApiToken(admin: SupabaseClient, token: string): Promise<AuthContext | null> {
  const { data } = await admin
    .from("api_tokens")
    .select("id, created_by, workspace:workspaces(id, name, slug)")
    .eq("token_hash", hashApiToken(token))
    .is("revoked_at", null)
    .maybeSingle<TokenRow>();
  if (!data?.workspace) return null;

  // Só informativo: falhar aqui nunca barra a chamada.
  await admin
    .from("api_tokens")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(
      () => undefined,
      () => undefined
    );

  return { userId: data.created_by, email: null, workspace: data.workspace };
}

/**
 * Quem está chamando: token da API (Authorization: Bearer pct_...) ou sessão do
 * navegador. Header com token inválido NUNCA cai para a sessão: responde 401.
 */
export async function getRequestAuth(request: Request): Promise<AuthContext | null> {
  if (!request.headers.has("authorization")) return getAuthContext();
  const token = readBearerToken(request);
  if (!token) return null;
  const admin = getSupabaseAdminClient();
  if (!admin) return null;
  return authenticateApiToken(admin, token);
}
