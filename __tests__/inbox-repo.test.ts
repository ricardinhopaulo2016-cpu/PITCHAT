import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "./fakes/fake-supabase";
import { loadConversationTimeline } from "@/lib/inbox/repo";

/**
 * Achado real 24/09/2026: o mesmo contato comentou "piada de papagaio" em
 * dois posts diferentes (external_media_id diferente) com ~1min de
 * diferença. Como loadConversationTimeline() agrega por contact_id +
 * social_account_id (não por media), as duas entradas apareciam lado a lado
 * com o mesmo texto — parecendo duplicata, mas sendo dois comentários Meta
 * reais e distintos (external_comment_id diferente, webhook_events
 * diferentes, cada um processado uma vez). Confirmado NÃO BUG por consulta
 * direta ao banco; o que faltava era só contexto visual — daí este teste.
 */
describe("loadConversationTimeline — contexto de post por comentário", () => {
  const conversationId = "conv-1";
  const contactId = "contact-1";
  const socialAccountId = "social-1";

  it("mesmo contato + mesmo texto + external_media_id diferente → duas entradas distintas, sem dedupe por texto", async () => {
    const supabase = createFakeSupabase();
    supabase.__tables.comments.push(
      {
        id: "comment-a",
        social_account_id: socialAccountId,
        contact_id: contactId,
        text: "piada de papagaio",
        created_at: "2026-09-24T16:13:48.723381+00:00",
        external_media_id: "18094963064641213",
      },
      {
        id: "comment-b",
        social_account_id: socialAccountId,
        contact_id: contactId,
        text: "piada de papagaio",
        created_at: "2026-09-24T16:14:44.06722+00:00",
        external_media_id: "18121225570904724",
      }
    );

    const { timeline } = await loadConversationTimeline(supabase as never, { conversationId, contactId, socialAccountId });

    const commentEntries = timeline.filter((e) => e.channel === "comment" && e.actor === "USER");
    expect(commentEntries).toHaveLength(2); // nenhuma das duas foi descartada por ter texto igual à outra

    const [first, second] = commentEntries;
    expect(first.text).toBe("piada de papagaio");
    expect(second.text).toBe("piada de papagaio");
    // cada entrada carrega o media/post correto — é isso que diferencia as duas na UI
    expect(first.externalMediaId).toBe("18094963064641213");
    expect(second.externalMediaId).toBe("18121225570904724");
    expect(first.externalMediaId).not.toBe(second.externalMediaId);

    // commentId aponta pra PK interna de cada linha, nunca uma mesclada
    expect(first.commentId).toBe("comment-a");
    expect(second.commentId).toBe("comment-b");
  });

  it("comment sem external_media_id não quebra a timeline", async () => {
    const supabase = createFakeSupabase();
    supabase.__tables.comments.push({
      id: "comment-legacy",
      social_account_id: socialAccountId,
      contact_id: contactId,
      text: "oi",
      created_at: "2026-09-24T10:00:00.000Z",
      external_media_id: null,
    });

    const { timeline } = await loadConversationTimeline(supabase as never, { conversationId, contactId, socialAccountId });

    expect(timeline).toHaveLength(1);
    expect(timeline[0].channel).toBe("comment");
    expect(timeline[0].externalMediaId).toBeNull();
  });

  it("mensagem (DM) recebe channel 'dm', comentário recebe channel 'comment'", async () => {
    const supabase = createFakeSupabase();
    supabase.__tables.comments.push({
      id: "comment-x",
      social_account_id: socialAccountId,
      contact_id: contactId,
      text: "comentei aqui",
      created_at: "2026-09-24T10:00:00.000Z",
      external_media_id: "111",
    });
    supabase.__tables.messages.push({
      id: "msg-x",
      conversation_id: conversationId,
      text: "mandei no direct",
      direction: "inbound",
      origin: null,
      created_at: "2026-09-24T10:05:00.000Z",
      sent_at: null,
      received_at: "2026-09-24T10:05:00.000Z",
    });

    const { timeline } = await loadConversationTimeline(supabase as never, { conversationId, contactId, socialAccountId });

    const comment = timeline.find((e) => e.id === "comment-comment-x");
    const message = timeline.find((e) => e.id === "msg-msg-x");
    expect(comment?.channel).toBe("comment");
    expect(message?.channel).toBe("dm");
  });
});
