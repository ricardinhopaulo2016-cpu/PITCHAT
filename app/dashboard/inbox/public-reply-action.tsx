"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * "Responder publicamente" — human takeover no lado do comentário (achado
 * real 24/09/2026: "Assumir conversa" só dava composer de DM; faltava
 * responder um comentário específico igual o PUBLIC_REPLY da automação
 * faz). Mesmo endpoint da Meta por trás (POST /{comment-id}/replies), ver
 * app/api/comments/[id]/reply/route.ts.
 */
export function PublicReplyAction({ commentId }: { commentId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/comments/${commentId}/reply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const json = await res.json();
    setSending(false);
    if (!res.ok) {
      setError(json.detail ?? json.error ?? "Falha ao responder.");
      toast("Não foi possível responder o comentário.", "danger");
      return;
    }
    setText("");
    setOpen(false);
    toast("Resposta pública enviada.", "success");
    router.refresh();
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] text-text-muted hover:text-signal">
        Responder publicamente
      </button>
    );
  }

  return (
    <div className="flex w-full max-w-[85%] flex-col gap-1.5">
      <Textarea
        rows={2}
        autoFocus
        value={text}
        placeholder="Resposta pública a este comentário…"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex items-center gap-2">
        <Button type="button" variant="secondary" disabled={sending} onClick={() => setOpen(false)}>
          Cancelar
        </Button>
        <Button type="button" variant="primary" disabled={sending || !text.trim()} onClick={send}>
          {sending ? "Enviando…" : "Responder"}
        </Button>
        {error && <span className="text-xs text-danger">{error}</span>}
      </div>
    </div>
  );
}
