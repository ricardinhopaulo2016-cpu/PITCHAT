"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronsUpDown } from "lucide-react";
import { PitchatMark, PitchatWordmark } from "@/components/icons/pitchat";
import { AccountTile } from "@/components/ui/account-tile";
import { SoundToggle } from "@/components/ui/sound-toggle";
import { LogoutButton } from "@/app/dashboard/logout-button";
import type { ChannelAccount } from "@/lib/channel/repo";
import { buildChannelSwitchHref, CHANNEL_PARAM, withChannelQuery } from "@/lib/channel/url";
import { UnreadBadge } from "@/components/ui/unread-badge";
import { INBOX_HREF, NAV_ITEMS, inboxUnreadLabel } from "./nav-items";
import { useInboxUnreadCount } from "./inbox-unread-provider";
import { LiveStatus } from "./realtime-provider";

/**
 * Menu lateral com nome em cada item e as contas sempre à vista. O filtro por
 * conta continua na URL (`?channel=<uuid>`). Em automações ele não se aplica,
 * porque a automação pertence ao perfil: as contas viram só contexto.
 */
export function Sidebar({
  workspaceName,
  email,
  accounts,
}: {
  workspaceName: string;
  email: string;
  accounts: ChannelAccount[];
}) {
  const inboxUnreadCount = useInboxUnreadCount();
  const pathname = usePathname() ?? "/dashboard";
  const searchParams = useSearchParams();
  const channelId = searchParams.get(CHANNEL_PARAM);
  const filterable = !pathname.startsWith("/dashboard/automations");
  const initial = workspaceName.trim().charAt(0).toUpperCase() || "?";

  return (
    <aside className="flex h-full w-[248px] shrink-0 flex-col gap-7 border-r border-border-subtle bg-bg-sidebar px-4 py-6">
      <Link href="/dashboard" className="flex items-center gap-2.5 px-2" aria-label="PITCHAT, Visão geral">
        <PitchatMark className="h-6 w-6 text-signal" />
        <PitchatWordmark className="text-base text-text" />
      </Link>

      <nav className="flex flex-col gap-0.5" aria-label="Principal">
        {NAV_ITEMS.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={withChannelQuery(item.href, channelId)}
              aria-current={isActive ? "page" : undefined}
              className={`flex h-11 items-center gap-3 rounded-[10px] px-3 font-medium transition-colors duration-[var(--motion-ui)] ${
                isActive ? "bg-surface-3 text-white" : "text-text-secondary hover:bg-surface-1 hover:text-text"
              }`}
            >
              <Icon className="h-[19px] w-[19px] shrink-0" strokeWidth={1.7} />
              {item.label}
              {item.href === INBOX_HREF && <UnreadBadge count={inboxUnreadCount} label={inboxUnreadLabel(inboxUnreadCount)} className="ml-auto" />}
            </Link>
          );
        })}
      </nav>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        <p className="px-3 pb-1 text-sm text-text-muted">Perfis</p>
        {filterable && accounts.length > 0 && (
          <Link
            href={buildChannelSwitchHref(pathname, searchParams, null)}
            aria-current={!channelId ? "true" : undefined}
            className={`flex h-10 shrink-0 items-center rounded-[10px] px-3 text-sm transition-colors duration-[var(--motion-ui)] ${
              !channelId ? "text-text" : "text-text-secondary hover:text-text"
            }`}
          >
            Todos os perfis
          </Link>
        )}
        {accounts.map((account) => {
          const label = account.username ? `@${account.username}` : "Conta sem username";
          const row = (
            <>
              <AccountTile username={account.username} size="sm" />
              <span className="min-w-0 truncate">{label}</span>
              {account.status !== "connected" && (
                <span className="ml-auto shrink-0 text-xs text-warning">{account.status === "expired" ? "expirada" : "atenção"}</span>
              )}
            </>
          );
          if (!filterable) {
            return (
              <div key={account.id} className="flex h-10 shrink-0 items-center gap-2.5 px-3 text-sm text-text-secondary">
                {row}
              </div>
            );
          }
          const selected = account.id === channelId;
          return (
            <Link
              key={account.id}
              href={buildChannelSwitchHref(pathname, searchParams, account.id)}
              aria-current={selected ? "true" : undefined}
              className={`flex h-10 shrink-0 items-center gap-2.5 rounded-[10px] px-3 text-sm transition-colors duration-[var(--motion-ui)] ${
                selected ? "bg-surface-3 text-white" : "text-text-secondary hover:bg-surface-1 hover:text-text"
              }`}
            >
              {row}
            </Link>
          );
        })}
        {accounts.length === 0 && <p className="px-3 text-sm text-text-muted">Nenhuma conta conectada</p>}
      </div>

      <LiveStatus className="-my-3 px-3" />

      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <button
            aria-label={`Menu do workspace ${workspaceName}`}
            className="flex h-12 w-full shrink-0 items-center gap-2.5 rounded-[10px] px-2 text-left transition-colors duration-[var(--motion-ui)] hover:bg-surface-1"
          >
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-surface-3 text-xs font-semibold text-text">{initial}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-text-secondary">{workspaceName}</span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-text-muted" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            side="top"
            align="start"
            sideOffset={8}
            className="z-50 w-[216px] rounded-[var(--radius-panel-sm)] border border-border bg-surface-elevated p-1 shadow-[var(--shadow-elevated)] data-[state=open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
          >
            <div className="px-2.5 py-2">
              <p className="truncate text-sm text-text">{workspaceName}</p>
              <p className="truncate text-xs text-text-muted">{email}</p>
            </div>
            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
            <DropdownMenu.Item onSelect={(e) => e.preventDefault()} className="outline-none">
              <SoundToggle />
            </DropdownMenu.Item>
            <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
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
