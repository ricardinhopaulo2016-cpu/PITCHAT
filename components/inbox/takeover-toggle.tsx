"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SignalMarker } from "@/components/icons/pitchat";
import { useToast } from "@/components/ui/toast";

/**
 * Human takeover — "Assumir conversa" / "Reativar automação". Nunca
 * ambíguo: o estado atual sempre aparece com marker + texto (nunca só cor),
 * mesmo padrão de components/ui/status-indicator.tsx. Manual usa o
 * semântico `warning` (âmbar) — nunca vermelho, que é reservado a falha.
 */
export function TakeoverToggle({ conversationId, automationEnabled }: { conversationId: string; automationEnabled: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [loading, setLoading] = useState(false);

  async function toggle(enabled: boolean) {
    setLoading(true);
    const res = await fetch(`/api/conversations/${conversationId}/automation`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
    setLoading(false);
    if (!res.ok) {
      toast("Não foi possível mudar o estado da automação.", "danger");
      return;
    }
    toast(enabled ? "Automação reativada." : "Atendimento manual assumido.", "success");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {automationEnabled ? (
        <span role="status" className="inline-flex items-center gap-1.5 text-[13px] text-text-secondary">
          <SignalMarker type="action" width={10} height={10} style={{ color: "var(--success)" }} />
          Automação ativa
        </span>
      ) : (
        <span
          role="status"
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-input)] border border-warning/40 bg-warning-soft px-2.5 py-1 text-[13px] font-medium text-warning"
        >
          <SignalMarker type="wait" width={10} height={10} />
          Operação manual
        </span>
      )}
      <Button type="button" variant="secondary" disabled={loading} onClick={() => toggle(!automationEnabled)}>
        {automationEnabled ? "Assumir conversa" : "Reativar automação"}
      </Button>
    </div>
  );
}
