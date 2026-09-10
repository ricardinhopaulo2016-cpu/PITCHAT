"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal } from "lucide-react";
import { PitchatMark, PitchatWordmark } from "@/components/icons/pitchat";
import { NAV_ITEMS } from "./nav-items";
import { LogoutButton } from "@/app/dashboard/logout-button";

/**
 * ~216px, faz parte da estrutura (não é floating rounded sidebar). Item
 * ativo: background sutil + texto mais forte + Signal Rail de 2px à esquerda
 * — nunca pill gigante nem glow (docs/PITCHAT_DESIGN_SYSTEM.md §8/§10).
 */
export function Sidebar({ workspaceName, email }: { workspaceName: string; email: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[216px] shrink-0 flex-col border-r border-border-subtle bg-bg-sidebar md:flex">
      <div className="flex items-center gap-2 px-5 py-5">
        <PitchatMark className="h-5 w-5 text-signal" />
        <PitchatWordmark className="text-[15px] text-text" />
      </div>

      <nav className="flex flex-1 flex-col gap-0.5 px-2.5">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
          const Icon = item.icon;

          if (item.comingSoon) {
            return (
              <div
                key={item.href}
                className="flex items-center justify-between rounded-[var(--radius-panel-sm)] px-2.5 py-2 text-sm text-text-muted"
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="h-[18px] w-[18px]" />
                  {item.label}
                </span>
                <span className="text-[11px]">Em breve</span>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`relative flex items-center gap-2.5 rounded-[var(--radius-panel-sm)] px-2.5 py-2 text-sm transition-colors duration-[var(--motion-ui)] ${
                isActive ? "bg-surface-2 text-text" : "text-text-muted hover:text-text-secondary"
              }`}
            >
              {isActive && (
                <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-signal" />
              )}
              <Icon className={`h-[18px] w-[18px] ${isActive ? "text-signal" : ""}`} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button className="flex items-center justify-between border-t border-border-subtle px-4 py-3 text-left transition-colors duration-[var(--motion-ui)] hover:bg-surface-1">
            <span className="min-w-0">
              <span className="block text-xs text-text-muted">Workspace</span>
              <span className="block truncate text-sm text-text">{workspaceName}</span>
              <span className="block truncate text-xs text-text-muted">{email}</span>
            </span>
            <MoreHorizontal className="h-4 w-4 shrink-0 text-text-muted" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={6}
            className="w-[188px] rounded-[var(--radius-panel-lg)] border border-border bg-surface-elevated p-1 shadow-[var(--shadow-elevated)] data-[state=open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
          >
            <DropdownMenu.Item asChild>
              <div className="rounded-[var(--radius-panel-sm)] px-2 py-1.5 text-sm text-danger outline-none data-[highlighted]:bg-danger-soft">
                <LogoutButton />
              </div>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </aside>
  );
}
