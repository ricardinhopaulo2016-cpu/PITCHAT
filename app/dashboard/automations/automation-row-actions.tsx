"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";

type Props = {
  automationId: string;
  status: "draft" | "active" | "paused" | "archived";
  hasPublishedVersion: boolean;
};

export function AutomationRowActions({ automationId, status, hasPublishedVersion }: Props) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: "active" | "paused" | "archived") {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/automations/${automationId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Falha ao mudar status");
    router.refresh();
  }

  async function duplicate() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/automations/${automationId}/duplicate`, { method: "POST" });
    const json = await res.json();
    setBusy(false);
    if (!res.ok) return setError(json.error ?? "Falha ao duplicar");
    router.push(`/dashboard/automations/${json.id}`);
  }

  return (
    <div className="flex items-center justify-end gap-2">
      {error && <span className="text-xs text-danger">{error}</span>}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            disabled={busy}
            aria-label="Mais ações"
            className="rounded-[var(--radius-panel-sm)] p-1.5 text-text-muted transition-colors duration-[var(--motion-fast)] hover:bg-surface-3 hover:text-text"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="w-44 rounded-[var(--radius-panel-lg)] border border-border bg-surface-elevated p-1 text-sm shadow-[var(--shadow-elevated)] data-[state=open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
          >
            <DropdownMenu.Item
              onSelect={duplicate}
              className="cursor-pointer rounded-[var(--radius-panel-sm)] px-2.5 py-1.5 text-text outline-none data-[highlighted]:bg-surface-2"
            >
              Duplicar
            </DropdownMenu.Item>
            {status !== "active" && status !== "archived" && (
              <DropdownMenu.Item
                onSelect={() => setStatus("active")}
                disabled={!hasPublishedVersion}
                title={hasPublishedVersion ? undefined : "Publique uma versão antes de ativar"}
                className="cursor-pointer rounded-[var(--radius-panel-sm)] px-2.5 py-1.5 text-success outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-40 data-[highlighted]:bg-success-soft"
              >
                Ativar
              </DropdownMenu.Item>
            )}
            {status === "active" && (
              <DropdownMenu.Item
                onSelect={() => setStatus("paused")}
                className="cursor-pointer rounded-[var(--radius-panel-sm)] px-2.5 py-1.5 text-warning outline-none data-[highlighted]:bg-warning-soft"
              >
                Pausar
              </DropdownMenu.Item>
            )}
            {status !== "archived" && (
              <DropdownMenu.Item
                onSelect={() => {
                  if (
                    confirm(
                      "Arquivar essa automação? Isso é permanente no V1 (arquivada não pode ser reativada — duplique se precisar)."
                    )
                  ) {
                    setStatus("archived");
                  }
                }}
                className="cursor-pointer rounded-[var(--radius-panel-sm)] px-2.5 py-1.5 text-danger outline-none data-[highlighted]:bg-danger-soft"
              >
                Arquivar
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
