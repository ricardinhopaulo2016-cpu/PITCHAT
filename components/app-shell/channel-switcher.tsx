"use client";

import Link from "next/link";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Check } from "lucide-react";
import { ChannelIcon } from "@/components/icons/pitchat";

export type ChannelSwitcherAccount = {
  id: string;
  username: string | null;
  status: string;
};

const STATUS_COLOR: Record<string, string> = {
  connected: "var(--success)",
  pending: "var(--text-muted)",
  expired: "var(--warning)",
  error: "var(--danger)",
};

/**
 * Infra visual do Channel Switcher (Fase B — Signal Desk V2, achado real
 * 24/09/2026: multi-Instagram é requisito de produto, mas ainda não existe
 * filtragem por conta em nenhuma tela). Mostra as contas reais do
 * workspace — nunca inventadas — mas só "Todos os canais" é seleção de
 * verdade hoje, porque não há nada real pra filtrar ainda. Contas
 * individuais aparecem como contexto, não como ação (evita prometer um
 * comportamento que o produto ainda não tem); "Gerenciar contas" é o único
 * link de verdade, vai pra tela que já existe.
 */
export function ChannelSwitcher({ accounts }: { accounts: ChannelSwitcherAccount[] }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-2 rounded-[var(--radius-button)] border border-border-subtle bg-surface-1 px-3 py-1.5 text-sm text-text transition-colors duration-[var(--motion-fast)] hover:border-border-strong">
          <ChannelIcon className="h-4 w-4 text-text-muted" />
          Todos os canais
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[260px] rounded-[var(--radius-panel-lg)] border border-border bg-surface-elevated p-1 shadow-[var(--shadow-elevated)] data-[state=open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
        >
          <div className="flex items-center justify-between rounded-[var(--radius-panel-sm)] px-2.5 py-2 text-sm text-text">
            <span className="flex items-center gap-2">
              <ChannelIcon className="h-4 w-4 text-text-muted" /> Todos os canais
            </span>
            <Check className="h-3.5 w-3.5 text-signal" />
          </div>

          {accounts.length > 0 && (
            <>
              <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
              <p className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">Instagram</p>
              {accounts.map((a) => (
                <div key={a.id} className="flex items-center gap-2 px-2.5 py-2 text-sm text-text-secondary">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[a.status] ?? "var(--text-muted)" }} />
                  <span className="truncate">{a.username ? `@${a.username}` : "Conta sem username"}</span>
                </div>
              ))}
            </>
          )}

          <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
          <DropdownMenu.Item asChild>
            <Link
              href="/dashboard/social-accounts"
              className="block rounded-[var(--radius-panel-sm)] px-2.5 py-2 text-sm text-text-secondary outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-text"
            >
              Gerenciar contas
            </Link>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
