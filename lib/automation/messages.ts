import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Grava mensagens reais na tabela `messages` — achado real da auditoria de
 * 24/09/2026: a tabela existe desde o início do schema, mas nenhum código
 * jamais escreveu nela. Sem isso, o Inbox não teria dado nenhum de verdade
 * pra mostrar (PRIVATE_REPLY/SEND_MESSAGE/QUICK_REPLY nunca persistiam o
 * texto enviado em lugar nenhum consultável). Extraído aqui (não direto em
 * engine.ts/ingest.ts) porque os dois módulos precisam gravar mensagem e
 * engine.ts não pode importar de ingest.ts (ingest.ts já importa de
 * engine.ts) sem criar dependência circular.
 */

export type MessageType = "text" | "button" | "quick_reply" | "image" | "link" | "system";

/** Código do Postgres para violação de índice único. */
const UNIQUE_VIOLATION = "23505";

/**
 * Folga na watermark de leitura. `sent_at` é o relógio do nosso servidor,
 * gravado depois da resposta da Meta, então fica sempre um pouco depois do
 * horário que a Meta deu à mensagem: sem folga, a última DM lida ficaria de
 * fora. A semântica real da watermark no Instagram ainda não foi vista em
 * produção (docs/PITCHAT_META_INTEGRATION.md §3).
 */
const WATERMARK_TOLERANCE_MS = 5_000;

/** `conversations.last_message_at` — achado real 24/09/2026: coluna existia, nunca era escrita; sem isso "ordenar por atividade mais recente" no Inbox não teria dado real. */
async function touchConversationActivity(admin: SupabaseClient, conversationId: string, atIso: string): Promise<void> {
  await admin.from("conversations").update({ last_message_at: atIso, updated_at: atIso }).eq("id", conversationId);
}

export async function recordOutboundMessage(
  admin: SupabaseClient,
  params: {
    workspaceId: string;
    conversationId: string;
    externalMessageId: string | null;
    type: MessageType;
    text: string;
    origin: "automation" | "manual";
    payload?: Record<string, unknown>;
  }
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from("messages").insert({
    workspace_id: params.workspaceId,
    conversation_id: params.conversationId,
    external_message_id: params.externalMessageId,
    direction: "outbound",
    origin: params.origin,
    type: params.type,
    text: params.text,
    payload: params.payload ?? {},
    status: "sent",
    sent_at: now,
  });
  await touchConversationActivity(admin, params.conversationId, now);
}

/** Registra uma tentativa de envio manual que a Meta recusou — nunca finge sucesso (ver app/api/conversations/[id]/messages/route.ts). */
export async function recordFailedOutboundMessage(
  admin: SupabaseClient,
  params: { workspaceId: string; conversationId: string; type: MessageType; text: string; origin: "automation" | "manual"; error: string }
): Promise<void> {
  await admin.from("messages").insert({
    workspace_id: params.workspaceId,
    conversation_id: params.conversationId,
    direction: "outbound",
    origin: params.origin,
    type: params.type,
    text: params.text,
    status: "failed",
    error: { message: params.error },
  });
}

/**
 * Marca que a PESSOA mandou algo: sobe a conversa e soma uma não lida. Só
 * entra aqui comentário novo, DM recebida e toque em botão; mensagem enviada
 * nunca passa por este caminho.
 *
 * Nunca lança: a contagem não pode impedir o disparo da automação nem derrubar
 * o worker. Se a RPC falhar (por exemplo, código no ar antes da migration), a
 * conversa ainda sobe pelo last_message_at, como antes.
 */
export async function registerInboundActivity(
  admin: SupabaseClient,
  params: { workspaceId: string; conversationId: string; at: string }
): Promise<void> {
  try {
    const { error } = await admin.rpc("register_conversation_inbound", {
      p_workspace_id: params.workspaceId,
      p_conversation_id: params.conversationId,
      p_at: params.at,
    });
    if (!error) return;
    console.error("[inbox] falha ao registrar entrada da pessoa:", error.message);
  } catch (err) {
    console.error("[inbox] falha ao registrar entrada da pessoa:", err instanceof Error ? err.message : String(err));
  }

  try {
    await touchConversationActivity(admin, params.conversationId, params.at);
  } catch {
    // Best-effort, ver comentário acima.
  }
}

/**
 * Grava a DM que a pessoa mandou e conta como não lida só na primeira vez.
 * Reenvio do webhook com o mesmo mid não grava nem conta de novo: a checagem
 * cobre o histórico, e o índice único cobre dois workers ao mesmo tempo.
 *
 * `failure` só vem preenchido em erro real do banco (duplicata não é erro):
 * quem chama decide se relança para o QStash repetir.
 */
export async function recordInboundMessage(
  admin: SupabaseClient,
  params: {
    workspaceId: string;
    conversationId: string;
    externalMessageId: string | null;
    type: MessageType;
    text: string | null;
    payload?: Record<string, unknown>;
  }
): Promise<{ inserted: boolean; failure: string | null }> {
  if (params.externalMessageId) {
    const { data: existing } = await admin
      .from("messages")
      .select("id")
      .eq("workspace_id", params.workspaceId)
      .eq("conversation_id", params.conversationId)
      .eq("external_message_id", params.externalMessageId)
      .eq("direction", "inbound")
      .limit(1)
      .maybeSingle();
    if (existing) return { inserted: false, failure: null };
  }

  const now = new Date().toISOString();
  const { error } = await admin.from("messages").insert({
    workspace_id: params.workspaceId,
    conversation_id: params.conversationId,
    external_message_id: params.externalMessageId,
    direction: "inbound",
    origin: "automation", // "origin" na tabela é sobre quem GEROU a mensagem do nosso lado (automação vs. humano) — mensagem inbound não tem "origin" próprio, mantido 'automation' só pra satisfazer o default/constraint, não tem leitura em lugar nenhum hoje.
    type: params.type,
    text: params.text,
    payload: params.payload ?? {},
    status: "delivered",
    received_at: now,
  });

  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) return { inserted: false, failure: null };
    console.error("[inbox] falha ao gravar mensagem recebida:", error.message);
    return { inserted: false, failure: error.message };
  }

  await registerInboundActivity(admin, { workspaceId: params.workspaceId, conversationId: params.conversationId, at: now });
  return { inserted: true, failure: null };
}

export type MarkReadResult = "marked" | "message_not_found" | "no_reference" | "failed";

/**
 * Confirmação de leitura da Meta: grava `read_at` na DM enviada indicada e em
 * toda enviada anterior a ela na conversa. Nunca altera `messages.status`
 * (as métricas contam por ele) e só preenche quem ainda está sem `read_at`,
 * então repetir o evento não muda nada.
 *
 * `externalMessageId` que não casa não marca nada, mesmo com watermark: só
 * registra o que a Meta confirmou sobre uma mensagem que existe aqui.
 */
export async function markOutboundMessagesRead(
  admin: SupabaseClient,
  params: {
    workspaceId: string;
    conversationId: string;
    externalMessageId: string | null;
    watermarkAt: string | null;
    readAt: string;
  }
): Promise<MarkReadResult> {
  let cutoff = params.watermarkAt ? new Date(Date.parse(params.watermarkAt) + WATERMARK_TOLERANCE_MS).toISOString() : null;

  if (params.externalMessageId) {
    const { data: target, error } = await admin
      .from("messages")
      .select("id, sent_at")
      .eq("workspace_id", params.workspaceId)
      .eq("conversation_id", params.conversationId)
      .eq("external_message_id", params.externalMessageId)
      .eq("direction", "outbound")
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("[inbox] falha ao localizar mensagem lida:", error.message);
      return "failed";
    }
    if (!target) return "message_not_found";
    cutoff = (target as { sent_at: string | null }).sent_at;
    if (!cutoff) {
      const { error: updateError } = await admin
        .from("messages")
        .update({ read_at: params.readAt })
        .eq("id", (target as { id: string }).id)
        .eq("workspace_id", params.workspaceId)
        .is("read_at", null);
      if (updateError) console.error("[inbox] falha ao gravar leitura:", updateError.message);
      return updateError ? "failed" : "marked";
    }
  }

  if (!cutoff) return "no_reference";

  const { error: updateError } = await admin
    .from("messages")
    .update({ read_at: params.readAt })
    .eq("workspace_id", params.workspaceId)
    .eq("conversation_id", params.conversationId)
    .eq("direction", "outbound")
    .in("status", ["sent", "delivered"])
    .is("read_at", null)
    .lte("sent_at", cutoff);
  if (updateError) {
    console.error("[inbox] falha ao gravar leitura:", updateError.message);
    return "failed";
  }
  return "marked";
}
