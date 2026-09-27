"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { ChevronDown, Check } from "lucide-react";
import { ChannelIcon } from "@/components/icons/pitchat";
import { groupChannelAccountsByProfile, type ChannelAccount } from "@/lib/channel/repo";
import { buildChannelSwitchHref, CHANNEL_PARAM } from "@/lib/channel/url";

export type ChannelSwitcherAccount = ChannelAccount;

const STATUS_COLOR: Record<string, string> = {
  connected: "var(--success)",
  pending: "var(--text-muted)",
  expired: "var(--warning)",
  error: "var(--danger)",
};

/**
 * Channel Switcher — filtro REAL por `social_accounts.id` (D1). A URL é a
 * única fonte de verdade (`?channel=<uuid>`; ausente = "Todos os canais");
 * cada item é um `<Link>` de verdade (Next.js App Router), nunca estado
 * client-only — preserva SSR, deep link, refresh, nova aba e Back/Forward.
 * Trocar de canal manualmente remove `conversation` da URL (nunca deixa uma
 * thread fora do filtro escolhido, ver lib/channel/url.ts).
 *
 * Em `/dashboard/automations*` a automação pertence ao PERFIL, não a uma
 * conta — o switcher vira contextual (nunca filtra automations); ver
 * docs/PITCHAT_ARCHITECTURE.md §13 (D1).
 */
export function ChannelSwitcher({ accounts }: { accounts: ChannelSwitcherAccount[] }) {
  const pathname = usePathname() ?? "/dashboard";
  const searchParams = useSearchParams();
  const selectedId = searchParams.get(CHANNEL_PARAM);
  const selected = selectedId ? accounts.find((a) => a.id === selectedId) : undefined;
  const groups = groupChannelAccountsByProfile(accounts);
  const isAutomationsScope = pathname.startsWith("/dashboard/automations");

  if (isAutomationsScope) {
    return (
      <span className="inline-flex items-center gap-2 rounded-[var(--radius-button)] border border-border-subtle bg-surface-1 px-3 py-1.5 text-sm text-text-secondary">
        <ChannelIcon className="h-4 w-4 text-text-muted" />
        Escopo por perfil
      </span>
    );
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button className="flex items-center gap-2 rounded-[var(--radius-button)] border border-border-subtle bg-surface-1 px-3 py-1.5 text-sm text-text transition-colors duration-[var(--motion-fast)] hover:border-border-strong">
          <ChannelIcon className="h-4 w-4 text-text-muted" />
          {selected ? (selected.username ? `@${selected.username}` : "Conta sem username") : "Todos os canais"}
          <ChevronDown className="h-3.5 w-3.5 text-text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[280px] rounded-[var(--radius-panel-lg)] border border-border bg-surface-elevated p-1 shadow-[var(--shadow-elevated)] data-[state=open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
        >
          <DropdownMenu.Item asChild>
            <Link
              href={buildChannelSwitchHref(pathname, searchParams, null)}
              aria-current={!selected ? "true" : undefined}
              className="flex items-center justify-between gap-2 rounded-[var(--radius-panel-sm)] px-2.5 py-2 text-sm text-text outline-none data-[highlighted]:bg-surface-2"
            >
              <span className="flex items-center gap-2">
                <ChannelIcon className="h-4 w-4 text-text-muted" /> Todos os canais
              </span>
              {!selected && <Check className="h-3.5 w-3.5 shrink-0 text-signal" aria-hidden="true" />}
            </Link>
          </DropdownMenu.Item>

          {groups.map((group) => (
            <div key={group.profileId}>
              <DropdownMenu.Separator className="my-1 h-px bg-border-subtle" />
              <p className="px-2.5 py-1 text-[11px] uppercase tracking-wide text-text-muted">{group.profileName}</p>
              {group.accounts.map((a) => {
                const isSelected = a.id === selectedId;
                return (
                  <DropdownMenu.Item key={a.id} asChild>
                    <Link
                      href={buildChannelSwitchHref(pathname, searchParams, a.id)}
                      aria-current={isSelected ? "true" : undefined}
                      className="flex items-center justify-between gap-2 rounded-[var(--radius-panel-sm)] px-2.5 py-2 text-sm text-text-secondary outline-none data-[highlighted]:bg-surface-2 data-[highlighted]:text-text"
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          aria-hidden="true"
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ background: STATUS_COLOR[a.status] ?? "var(--text-muted)" }}
                        />
                        <span className="truncate">{a.username ? `@${a.username}` : "Conta sem username"}</span>
                        {a.status !== "connected" && <span className="shrink-0 text-[11px] text-text-muted">({a.status})</span>}
                      </span>
                      {isSelected && <Check className="h-3.5 w-3.5 shrink-0 text-signal" aria-hidden="true" />}
                    </Link>
                  </DropdownMenu.Item>
                );
              })}
            </div>
          ))}

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
