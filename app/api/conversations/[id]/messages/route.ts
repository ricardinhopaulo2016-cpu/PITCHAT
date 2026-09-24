import { NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth/session";
import { getSupabaseAdminClient } from "@/lib/supabase/admin";
import { loadConversationForWorkspace } from "@/lib/inbox/repo";
import { decryptToken } from "@/lib/meta/token-crypto";
import { MetaApiError, realMetaClient } from "@/lib/meta/client";
import { recordFailedOutboundMessage, recordOutboundMessage } from "@/lib/automation/messages";

export const runtime = "nodejs";

/**
 * Envio manual pelo Inbox — usa o Send API padrão (POST /{ig-user-id}/messages,
 * recipient.id), a mesma janela de 24h documentada em
 * docs/PITCHAT_META_INTEGRATION.md §6. Não pré-valida a janela no nosso lado
 * (calcular isso certo exigiria reconstruir a política exata da Meta, que já
 * documentamos como não totalmente confirmada) — tenta enviar de verdade e
 * repassa o erro REAL se a Meta recusar. Nunca finge sucesso.
 *
 * Human Agent tag (§6, permite responder fora da 24h por até 7 dias) não
 * está implementada ainda — fora de escopo desta rota até ser pedida.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await getAuthContext();
  if (!auth) return NextResponse.json({ error: "UNAUTHORIZED" }, { status: 401 });

  const admin = getSupabaseAdminClient();
  if (!admin) return NextResponse.json({ error: "SUPABASE_NOT_CONFIGURED" }, { status: 503 });

  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return NextResponse.json({ error: "INVALID_BODY", detail: "esperado { text: string não vazio }" }, { status: 400 });

  const conversation = await loadConversationForWorkspace(admin, id, auth.workspace.id);
  if (!conversation) return NextResponse.json({ error: "CONVERSATION_NOT_FOUND" }, { status: 404 });

  const [{ data: socialAccount }, { data: contact }] = await Promise.all([
    admin
      .from("social_accounts")
      .select("external_account_id, access_token_encrypted")
      .eq("id", conversation.social_account_id)
      .maybeSingle(),
    admin.from("contacts").select("platform_user_id").eq("id", conversation.contact_id).maybeSingle(),
  ]);

  if (!socialAccount?.access_token_encrypted) {
    return NextResponse.json({ error: "SOCIAL_ACCOUNT_NOT_CONNECTED" }, { status: 409 });
  }
  if (!contact) return NextResponse.json({ error: "CONTACT_NOT_FOUND" }, { status: 404 });

  try {
    const accessToken = decryptToken(socialAccount.access_token_encrypted);
    const result = await realMetaClient.sendTextMessage({
      accessToken,
      igUserId: socialAccount.external_account_id,
      recipientId: contact.platform_user_id,
      text,
    });

    await recordOutboundMessage(admin, {
      workspaceId: auth.workspace.id,
      conversationId: id,
      externalMessageId: result.externalMessageId,
      type: "text",
      text,
      origin: "manual",
    });

    return NextResponse.json({ ok: true, externalMessageId: result.externalMessageId });
  } catch (err) {
    // Erro REAL da Meta, sanitizado (nunca o token) — nunca fingimos sucesso.
    const message = err instanceof Error ? err.message : "Falha desconhecida ao enviar mensagem";
    const code = err instanceof MetaApiError ? err.code : undefined;
    const subcode = err instanceof MetaApiError ? err.subcode : undefined;

    await recordFailedOutboundMessage(admin, {
      workspaceId: auth.workspace.id,
      conversationId: id,
      type: "text",
      text,
      origin: "manual",
      error: message,
    });

    return NextResponse.json({ error: "META_SEND_FAILED", detail: message, code, subcode }, { status: 422 });
  }
}
