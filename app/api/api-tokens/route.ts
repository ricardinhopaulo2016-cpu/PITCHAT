import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { generateApiToken, hashApiToken } from "@/lib/auth/api-token";

export const runtime = "nodejs";

const MAX_ACTIVE_TOKENS = 10;

/** Só sessão do navegador: um token da API nunca cria outro token. */
export async function POST(request: Request) {
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const parsed = z.object({ name: z.string().trim().min(1).max(60) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "INVALID_BODY", problems: ["Dê um nome ao token."] }, { status: 400 });

  const { count } = await admin
    .from("api_tokens")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", auth.workspace.id)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_TOKENS) {
    return NextResponse.json({ error: "TOO_MANY_TOKENS", problems: [`Revogue um token antes: o limite é ${MAX_ACTIVE_TOKENS}.`] }, { status: 422 });
  }

  const token = generateApiToken();
  const { data, error } = await admin
    .from("api_tokens")
    .insert({
      workspace_id: auth.workspace.id,
      name: parsed.data.name,
      token_hash: hashApiToken(token),
      token_prefix: token.slice(0, 10),
      created_by: auth.userId,
    })
    .select("id, name, token_prefix, created_at")
    .single();
  if (error || !data) return NextResponse.json({ error: "DB_INSERT_FAILED", problems: ["Não foi possível gerar o token."] }, { status: 500 });

  // Única vez que o token aparece em texto. O banco só tem o hash.
  return NextResponse.json({ ...data, token }, { status: 201 });
}
