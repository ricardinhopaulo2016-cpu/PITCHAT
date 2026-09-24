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
): Promise<void> {
  const now = new Date().toISOString();
  await admin.from("messages").insert({
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
  await touchConversationActivity(admin, params.conversationId, now);
}
