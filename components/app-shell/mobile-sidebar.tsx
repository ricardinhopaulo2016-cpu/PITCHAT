"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Menu, X } from "lucide-react";
import { ChannelIcon, PitchatMark, PitchatWordmark } from "@/components/icons/pitchat";
import { NAV_ITEMS } from "./nav-items";
import { LogoutButton } from "@/app/dashboard/logout-button";
import { SoundToggle } from "@/components/ui/sound-toggle";
import type { ChannelSwitcherAccount } from "./channel-switcher";

const STATUS_COLOR: Record<string, string> = {
  connected: "var(--success)",
  pending: "var(--text-muted)",
  expired: "var(--warning)",
  error: "var(--danger)",
};

/** Sidebar vira drawer no mobile — nada essencial desaparece (docs/PITCHAT_DESIGN_SYSTEM.md, seção 43 do briefing). */
export function MobileSidebar({
  workspaceName,
  email,
  accounts,
}: {
  workspaceName: string;
  email: string;
  accounts: ChannelSwitcherAccount[];
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <div className="flex items-center justify-between border-b border-border-subtle bg-bg-sidebar px-4 py-3 md:hidden">
        <div className="flex items-center gap-2">
          <PitchatMark className="h-5 w-5 text-signal" />
          <PitchatWordmark className="text-sm text-text" />
        </div>
        <Dialog.Trigger asChild>
          <button aria-label="Abrir menu" className="text-text-secondary">
            <Menu className="h-5 w-5" />
          </button>
        </Dialog.Trigger>
      </div>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/60 data-[state=open]:animate-[panel-in_var(--motion-panel)_var(--ease-out)]" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[240px] flex-col bg-bg-sidebar shadow-[var(--shadow-elevated)] data-[state=open]:animate-[dialog-in_var(--motion-panel)_var(--ease-out)]">
          <div className="flex items-center justify-between px-5 py-5">
            <div className="flex items-center gap-2">
              <PitchatMark className="h-5 w-5 text-signal" />
              <PitchatWordmark className="text-[15px] text-text" />
            </div>
            <Dialog.Close aria-label="Fechar menu" className="text-text-muted">
              <X className="h-4 w-4" />
            </Dialog.Close>
          </div>

          <Dialog.Title className="sr-only">Menu de navegação</Dialog.Title>

          {/* Contexto de canal compacto — mesma peça do TopBar desktop, sem
              switcher completo aqui: espaço é curto, e no mobile a lista de
              contas em si mora em Social Accounts. */}
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3 text-xs text-text-muted">
            <ChannelIcon className="h-3.5 w-3.5" />
            {accounts.length === 1
              ? `@${accounts[0].username ?? "conta"}`
              : accounts.length > 1
                ? `${accounts.length} contas Instagram`
                : "Nenhuma conta conectada"}
            {accounts.length === 1 && (
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: STATUS_COLOR[accounts[0].status] ?? "var(--text-muted)" }} />
            )}
          </div>

          <nav className="flex flex-1 flex-col gap-0.5 px-2.5">
            {NAV_ITEMS.map((item) => {
              const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
              const Icon = item.icon;
              if (item.comingSoon) {
                return (
                  <div key={item.href} className="flex items-center justify-between px-2.5 py-2.5 text-sm text-text-muted">
                    <span className="flex items-center gap-2.5">
                      <Icon className="h-[18px] w-[18px]" /> {item.label}
                    </span>
                    <span className="text-[11px]">Em breve</span>
                  </div>
                );
              }
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={`relative flex items-center gap-2.5 rounded-[var(--radius-panel-sm)] px-2.5 py-2.5 text-sm ${
                    isActive ? "bg-surface-2 text-text" : "text-text-muted"
                  }`}
                >
                  {isActive && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-signal" />}
                  <Icon className={`h-[18px] w-[18px] ${isActive ? "text-signal" : ""}`} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="border-t border-border-subtle px-4 py-3 text-sm">
            <p className="text-xs text-text-muted">Workspace</p>
            <p className="truncate text-text">{workspaceName}</p>
            <p className="truncate text-xs text-text-muted">{email}</p>
            <div className="mt-2 -mx-2.5">
              <SoundToggle />
            </div>
            <div className="mt-1 text-danger">
              <LogoutButton />
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
