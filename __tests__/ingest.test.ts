import { describe, expect, it, vi } from "vitest";
import { ingestInstagramComment, ingestInstagramMessage } from "@/lib/automation/ingest";
import { encryptToken } from "@/lib/meta/token-crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InstagramCommentReceived } from "@/lib/meta/events";
import type { MetaClient } from "@/lib/meta/client";
import { createFakeSupabase } from "./fakes/fake-supabase";

// META_TOKEN_ENCRYPTION_KEY precisa existir ANTES de qualquer encryptToken/
// decryptToken (ingestInstagramComment decifra o token sempre, mesmo quando
// não há automação ativa pra usá-lo de verdade).
process.env.META_TOKEN_ENCRYPTION_KEY ??= "test-key-fake-supabase-ingest-suite";

const socialAccount = {
  id: "sa1",
  workspace_id: "ws1",
  profile_id: "profile1",
  external_account_id: "ig-account-1",
  access_token_encrypted: encryptToken("fake-access-token-nunca-usado-de-verdade"),
};

function fakeMeta(): MetaClient {
  return {
    sendPublicReply: vi.fn().mockResolvedValue(undefined),
    sendPrivateReply: vi.fn().mockResolvedValue({ externalMessageId: "m1" }),
    sendTextMessage: vi.fn().mockResolvedValue({ externalMessageId: "m2" }),
    sendQuickReplies: vi.fn().mockResolvedValue({ externalMessageId: "m3" }),
    sendButtonTemplate: vi.fn().mockResolvedValue({ externalMessageId: "m4" }),
  };
}

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

describe("ingestInstagramComment — human takeover (achado real 24/09/2026)", () => {
  const event = {
    type: "InstagramCommentReceived" as const,
    externalAccountId: "ig-account-1",
    externalCommentId: "c1",
    externalMediaId: "media1",
    parentCommentId: null,
    fromUserId: "user-igsid-1",
    fromUsername: "alguem",
    text: "piada de papagaio",
    timestamp: new Date().toISOString(),
  };

  it("conversa com automation_enabled=false: comentário é gravado, mas NENHUMA automation_run é criada", async () => {
    const fake = createFakeSupabase();
    fake.__tables.conversations.push({
      id: "conv1",
      social_account_id: "sa1",
      contact_id: "contact-existing",
      automation_enabled: false,
    });
    fake.__tables.contacts.push({ id: "contact-existing", workspace_id: "ws1", platform: "instagram", platform_user_id: "user-igsid-1" });

    const result = await ingestInstagramComment(fake as never, fakeMeta(), socialAccount, event);

    expect(result).toEqual({ processed: false, reason: "AUTOMATION_DISABLED_HUMAN_TAKEOVER" });
    expect(fake.__tables.comments).toHaveLength(1); // o comentário em si é real e fica registrado
    expect(fake.__tables.automation_runs).toHaveLength(0); // mas nenhuma automação dispara
  });

  it("conversa nova (automation_enabled default true) continua dependendo normalmente das automações ativas do perfil", async () => {
    const fake = createFakeSupabase();
    fake.__tables.contacts.push({ id: "contact-new", workspace_id: "ws1", platform: "instagram", platform_user_id: "user-igsid-1" });
    // Sem conversa pré-existente -> upsertConversation cria uma nova, com
    // automation_enabled default true (a própria query de insert não define
    // o campo, então o objeto retornado pelo fake não tem automation_enabled
    // explícito — undefined é tratado como "não desabilitado" pelo gate,
    // igual o Postgres real trataria com o `default true` da coluna).

    const result = await ingestInstagramComment(fake as never, fakeMeta(), socialAccount, event);

    expect(result).toEqual({ processed: true });
    expect(fake.__tables.comments).toHaveLength(1);
    // Sem automação ativa cadastrada no fake, o loop simplesmente não roda —
    // o que importa aqui é que NÃO foi bloqueado pelo gate de takeover.
    expect(fake.__tables.automation_runs).toHaveLength(0);
  });

  it("comentário duplicado (mesmo social_account+external_comment_id) nunca dispara automação de novo, com ou sem takeover", async () => {
    const fake = createFakeSupabase();
    fake.__tables.contacts.push({ id: "contact-existing", workspace_id: "ws1", platform: "instagram", platform_user_id: "user-igsid-1" });
    fake.__tables.comments.push({ id: "existing-comment", social_account_id: "sa1", external_comment_id: "c1" });

    const result = await ingestInstagramComment(fake as never, fakeMeta(), socialAccount, event);
    expect(result).toEqual({ processed: false, reason: "DUPLICATE_COMMENT_IGNORED" });
  });
});

describe("ingestInstagramMessage — DM avulsa (achado real 24/09/2026: antes era descartada)", () => {
  it("grava a mensagem real em `messages`, sem disparar nenhuma automação", async () => {
    const fake = createFakeSupabase();
    fake.__tables.contacts.push({ id: "contact1", workspace_id: "ws1", platform: "instagram", platform_user_id: "user-igsid-2" });
    fake.__tables.conversations.push({ id: "conv1", social_account_id: "sa1", contact_id: "contact1", automation_enabled: true });

    const result = await ingestInstagramMessage(fake as never, socialAccount, {
      type: "InstagramMessageReceived",
      externalAccountId: "ig-account-1",
      externalMessageId: "m-real-1",
      fromUserId: "user-igsid-2",
      text: "oi, tudo bem?",
      timestamp: new Date().toISOString(),
    });

    expect(result).toEqual({ processed: true });
    expect(fake.__tables.messages).toHaveLength(1);
    expect(fake.__tables.messages[0]).toMatchObject({ direction: "inbound", type: "text", text: "oi, tudo bem?" });
  });

  it("ignora eco da própria conta (fromUserId === external_account_id), nunca grava como mensagem de um contato", async () => {
    const fake = createFakeSupabase();
    const result = await ingestInstagramMessage(fake as never, socialAccount, {
      type: "InstagramMessageReceived",
      externalAccountId: "ig-account-1",
      externalMessageId: "m-echo",
      fromUserId: "ig-account-1", // igual ao external_account_id da própria conta
      text: "eco",
      timestamp: new Date().toISOString(),
    });
    expect(result).toEqual({ processed: false, reason: "IGNORED_OWN_MESSAGE" });
    expect(fake.__tables.messages).toHaveLength(0);
  });
});
