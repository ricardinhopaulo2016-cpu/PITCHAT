import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/meta/token-crypto";
import { MetaApiError, realMetaClient } from "@/lib/meta/client";

export const runtime = "nodejs";

/**
 * Resposta pública manual a um comentário específico — parte do human
 * takeover (achado real 24/09/2026: "Assumir conversa" só dava composer de
 * DM; faltava responder publicamente igual o PUBLIC_REPLY da automação faz).
 * Mesmo endpoint da Meta (POST /{comment-id}/replies) que o engine já usa.
 *
 * Registrado em `audit_logs` (ação, texto, quem, quando) — não vira uma
 * linha em `comments` (essa tabela modela comentário RECEBIDO de um
 * contato, não resposta nossa) nem em `messages` (isso é DM, não reply de
 * comentário). Se no futuro for preciso mostrar a resposta encaixada na
 * timeline, aí sim vale capturar o ID da nova resposta — fora de escopo
 * agora, feature nova mínima o suficiente pro pedido de hoje.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: commentId } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "INVALID_BODY", detail: "esperado { text: string não vazio }" }, { status: 400 });

  // Nunca confiar em commentId vindo do client sem validar que pertence ao
  // workspace (docs/PITCHAT_ARCHITECTURE.md §4) — `comments.id` é a PK
  // interna nossa, não o external_comment_id da Meta.
  const { data: comment } = await admin
    .from("comments")
    .select("id, external_comment_id, social_account_id")
    .eq("id", commentId)
    .eq("workspace_id", auth.workspace.id)
    .maybeSingle();
  if (!comment) return NextResponse.json({ error: "COMMENT_NOT_FOUND" }, { status: 404 });

  const { data: socialAccount } = await admin
    .from("social_accounts")
    .select("access_token_encrypted")
    .eq("id", comment.social_account_id)
    .maybeSingle();
  if (!socialAccount?.access_token_encrypted) {
    return NextResponse.json({ error: "SOCIAL_ACCOUNT_NOT_CONNECTED" }, { status: 409 });
  }

  try {
    const accessToken = decryptToken(socialAccount.access_token_encrypted);
    await realMetaClient.sendPublicReply({ accessToken, commentId: comment.external_comment_id, text });

    await admin.from("audit_logs").insert({
      workspace_id: auth.workspace.id,
      actor_user_id: auth.userId,
      action: "comment.manual_public_reply",
      entity_type: "comment",
      entity_id: comment.id,
      after: { text },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    // Erro REAL da Meta, sanitizado — nunca fingimos sucesso.
    const message = err instanceof Error ? err.message : "Falha desconhecida ao responder o comentário";
    const code = err instanceof MetaApiError ? err.code : undefined;
    const subcode = err instanceof MetaApiError ? err.subcode : undefined;
    return NextResponse.json({ error: "META_REPLY_FAILED", detail: message, code, subcode }, { status: 422 });
  }
}
