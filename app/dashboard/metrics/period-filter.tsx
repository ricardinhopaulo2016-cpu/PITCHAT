"use client";

import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_PERIOD_DAYS } from "@/lib/metrics/constants";
import { customRangeHref, PERIOD_SHORTCUTS, shortcutHref, type PeriodChoice } from "@/lib/metrics/period";

const CHIP = "relative inline-flex h-10 items-center rounded-[var(--radius-button)] border px-3.5 text-sm transition-colors duration-[var(--motion-fast)]";
const CHIP_ACTIVE = "border-signal bg-signal-soft font-medium text-text";
const CHIP_IDLE = "border-border bg-surface-1 text-text-secondary hover:border-border-strong hover:text-text";

/**
 * Só a query muda, então `loading.tsx` não reaparece. Sem isto, o clique parece
 * não ter feito nada enquanto as consultas rodam. O ponto é absoluto para o
 * botão não mudar de largura.
 */
function ChipLabel({ children }: { children: ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span data-period-pending={pending ? "" : undefined} className={pending ? "opacity-70" : undefined}>
      {children}
      <span aria-hidden="true" className={`absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-signal ${pending ? "animate-pulse" : "opacity-0"}`} />
      <span role="status" className="sr-only">
        {pending ? "Carregando período" : ""}
      </span>
    </span>
  );
}

/**
 * O período vive na URL, então sobrevive a refresh e dá para mandar o link.
 * A página passa `key` com o período resolvido: mudou o período, os campos recomeçam.
 */
export function PeriodFilter({ choice, from, to, today }: { choice: PeriodChoice; from: string; to: string; today: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isCustom = choice === "personalizado";
  const [open, setOpen] = useState(isCustom);
  const [draftFrom, setDraftFrom] = useState(from);
  const [draftTo, setDraftTo] = useState(to);
  const [isPending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draftFrom || !draftTo) return;
    startTransition(() => router.push(customRangeHref(pathname, new URLSearchParams(searchParams.toString()), draftFrom, draftTo), { scroll: false }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div role="group" aria-label="Período" className="flex flex-wrap gap-2">
        {PERIOD_SHORTCUTS.map((shortcut) => {
          const active = choice === shortcut.key;
          return (
            <Link
              key={shortcut.key}
              href={shortcutHref(pathname, new URLSearchParams(searchParams.toString()), shortcut.key)}
              prefetch={false}
              scroll={false}
              aria-current={active ? "true" : undefined}
              className={`${CHIP} ${active ? CHIP_ACTIVE : CHIP_IDLE}`}
            >
              <ChipLabel>{shortcut.label}</ChipLabel>
            </Link>
          );
        })}
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="periodo-personalizado" aria-current={isCustom ? "true" : undefined} className={`${CHIP} ${isCustom ? CHIP_ACTIVE : CHIP_IDLE}`}>
          Personalizado
        </button>
      </div>

      {open && (
        <form id="periodo-personalizado" onSubmit={submit} aria-busy={isPending} data-period-pending={isPending ? "" : undefined} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            De
            <Input type="date" required value={draftFrom} max={today} onChange={(event) => setDraftFrom(event.target.value)} className="w-[170px]" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Até
            <Input type="date" required value={draftTo} max={today} onChange={(event) => setDraftTo(event.target.value)} className="w-[170px]" />
          </label>
          <Button type="submit" disabled={!draftFrom || !draftTo || isPending}>
            {isPending ? "Aplicando" : "Aplicar"}
          </Button>
          <p className="pb-3 text-xs text-text-muted">Até {MAX_PERIOD_DAYS} dias, em horário de Brasília.</p>
        </form>
      )}
    </div>
  );
}
