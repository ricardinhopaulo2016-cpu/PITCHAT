import { describe, expect, it } from "vitest";
import { ingestInstagramComment } from "@/lib/automation/ingest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MetaClient } from "@/lib/meta/client";
import type { InstagramCommentReceived } from "@/lib/meta/events";

/**
 * Cobertura parcial de lib/automation/ingest.ts — só a guarda de
 * "ignora comentário da própria conta" (seção 6 do pedido de E2E real,
 * 09/09/2026). Cobertura completa de ingestInstagramComment/ingestInstagramQuickReply
 * fica pendente (gap já documentado em docs/PITCHAT_ARCHITECTURE.md §12).
 */

// Admin que explode se qualquer query for feita — prova que a guarda retorna
// ANTES de tocar no banco (nunca cria contact/comment pra comentário próprio).
const explodingAdmin = {
  from() {
    throw new Error("admin.from() não deveria ser chamado pra comentário da própria conta");
  },
} as unknown as SupabaseClient;

const explodingMeta = {
  sendPublicReply() {
    throw new Error("não deveria chamar a Meta pra comentário da própria conta");
  },
} as unknown as MetaClient;

const socialAccount = {
  id: "sa-1",
  workspace_id: "ws-1",
  profile_id: "profile-1",
  external_account_id: "17841400000000000",
  access_token_encrypted: "cipher:xxx",
};

function commentFrom(fromUserId: string): InstagramCommentReceived {
  return {
    type: "InstagramCommentReceived",
    externalAccountId: socialAccount.external_account_id,
    externalCommentId: "c1",
    externalMediaId: "m1",
    parentCommentId: null,
    fromUserId,
    fromUsername: "alguem",
    text: "eu quero",
    timestamp: new Date().toISOString(),
  };
}

describe("ingestInstagramComment — ignora comentário da própria conta", () => {
  it("retorna IGNORED_OWN_COMMENT quando fromUserId === external_account_id da conta, sem tocar em banco/Meta", async () => {
    const event = commentFrom(socialAccount.external_account_id);
    const result = await ingestInstagramComment(explodingAdmin, explodingMeta, socialAccount, event);
    expect(result).toEqual({ processed: false, reason: "IGNORED_OWN_COMMENT" });
  });

  it("não ignora comentário de outro usuário (fromUserId diferente)", async () => {
    const event = commentFrom("999999999999");
    // Aqui o admin/meta explodem em seguida (não é o alvo deste teste) — só
    // confirmamos que a guarda NÃO barrou, ou seja, o erro veio de mais
    // adiante na função (prova que passou da guarda).
    await expect(ingestInstagramComment(explodingAdmin, explodingMeta, socialAccount, event)).rejects.toThrow(
      /admin\.from/
    );
  });
});
