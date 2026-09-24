"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Envio manual — usa a janela de mensagens real da Meta (ver
 * app/api/conversations/[id]/messages/route.ts). Nunca finge sucesso: erro
 * real da Meta aparece sanitizado abaixo do campo, nunca um toast genérico
 * escondendo o motivo.
 */
export function MessageComposer({ conversationId }: { conversationId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    if (!text.trim()) return;
    setSending(true);
    setError(null);
    const res = await fetch(`/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const json = await res.json();
    setSending(false);
    if (!res.ok) {
      setError(json.detail ?? json.error ?? "Falha ao enviar mensagem.");
      toast("Não foi possível enviar a mensagem.", "danger");
      return;
    }
    setText("");
    toast("Mensagem enviada.", "success");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-2 border-t border-border-subtle p-4">
      <Textarea
        rows={2}
        value={text}
        placeholder="Mensagem manual…"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
      />
      <div className="flex items-center justify-between gap-3">
        {error ? <span className="text-xs text-danger">{error}</span> : <span />}
        <Button type="button" variant="primary" disabled={sending || !text.trim()} onClick={send}>
          {sending ? "Enviando…" : "Enviar"}
        </Button>
      </div>
    </div>
  );
}
