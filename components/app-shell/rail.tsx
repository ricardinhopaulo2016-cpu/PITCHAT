"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { PitchatMark } from "@/components/icons/pitchat";
import { NAV_ITEMS } from "./nav-items";
import { LogoutButton } from "@/app/dashboard/logout-button";
import { SoundToggle } from "@/components/ui/sound-toggle";
import { Tooltip, TooltipProvider } from "@/components/ui/tooltip";

/**
 * Thin Rail — Fase B (Signal Desk V2, direção aprovada 25/09/2026). Substitui
 * a sidebar de 216px por um rail de 64px, só ícone. Nada do que a sidebar
 * anterior fazia foi descartado, só realocado:
 *  - label de texto → tooltip (Radix, acessível) + aria-label, nunca só um
 *    dos dois;
 *  - workspace/email/som/logout → mesmo DropdownMenu de antes, agora aberto
 *    a partir do círculo de iniciais no rodapé do rail (side="right");
 *  - "Em breve" → ícone com opacidade reduzida, não clicável, tooltip
 *    explica.
 * Nunca copiar o protótipo do Gemini literalmente — ícones centrais
 * continuam os SVGs próprios do PITCHAT (nunca Lucide/Phosphor pra
 * identidade, docs/PITCHAT_DESIGN_SYSTEM.md §10).
 */
export function Rail({ workspaceName, email }: { workspaceName: string; email: string }) {
  const pathname = usePathname();
  const initial = workspaceName.trim().charAt(0).toUpperCase() || "?";

  return (
    <TooltipProvider>
      <aside className="hidden w-16 shrink-0 flex-col items-center border-r border-border-subtle bg-bg-sidebar py-5 md:flex">
        <Link href="/dashboard" className="mb-6" aria-label="PITCHAT — Dashboard">
          <PitchatMark className="h-6 w-6 text-signal" />
        </Link>

        <nav className="flex flex-1 flex-col items-center gap-1">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname?.startsWith(item.href));
            const Icon = item.icon;

            if (item.comingSoon) {
              return (
                <Tooltip key={item.href} content={`${item.label} · Em breve`}>
                  <div
                    aria-label={`${item.label} — em breve`}
                    className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-panel-sm)] text-text-muted opacity-40"
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </div>
                </Tooltip>
              );
            }

            return (
              <Tooltip key={item.href} content={item.label}>
                <Link
                  href={item.href}
                  aria-label={item.label}
                  aria-current={isActive ? "page" : undefined}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-[var(--radius-panel-sm)] transition-colors duration-[var(--motion-ui)] ${
                    isActive ? "bg-surface-2 text-signal" : "text-text-muted hover:text-text-secondary"
                  }`}
                >
                  {isActive && (
                    <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-signal" />
                  )}
                  <Icon className="h-[18px] w-[18px]" />
                </Link>
              </Tooltip>
            );
          })}
        </nav>

        <DropdownMenu.Root>
          <Tooltip content={workspaceName} side="right">
            <DropdownMenu.Trigger asChild>
              <button
                aria-label={`Menu do workspace ${workspaceName}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 font-mono text-xs text-text-secondary transition-colors duration-[var(--motion-ui)] hover:text-text"
              >
                {initial}
              </button>
            </DropdownMenu.Trigger>
          </Tooltip>
          <DropdownMenu.Portal>
            <DropdownMenu.Content
              side="right"
              align="end"
              sideOffset={10}
              className="w-[200px] rounded-[var(--radius-panel-lg)] border border-border bg-surface-elevated p-1 shadow-[var(--shadow-elevated)] data-[state=open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
            >
              <div className="px-2.5 py-2">
                <p className="text-xs text-text-muted">Workspace</p>
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
    </TooltipProvider>
  );
}
