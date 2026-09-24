"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SignalMarker } from "@/components/icons/pitchat";
import { useToast } from "@/components/ui/toast";

/**
 * Human takeover — "Assumir conversa" / "Reativar automação". Nunca
 * ambíguo: o estado atual sempre aparece com marker + texto (nunca só cor),
 * mesmo padrão de components/ui/status-indicator.tsx.
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
    <div className="flex items-center gap-3">
      <span
        className="inline-flex items-center gap-1.5 text-sm"
        style={{ color: automationEnabled ? "var(--success)" : "var(--warning)" }}
      >
        <SignalMarker
          type={automationEnabled ? "action" : "wait"}
          width={10}
          height={10}
          style={{ color: automationEnabled ? "var(--success)" : "var(--warning)" }}
        />
        {automationEnabled ? "Automação ativa" : "Atendimento manual"}
      </span>
      <Button type="button" variant="secondary" disabled={loading} onClick={() => toggle(!automationEnabled)}>
        {automationEnabled ? "Assumir conversa" : "Reativar automação"}
      </Button>
    </div>
  );
}
