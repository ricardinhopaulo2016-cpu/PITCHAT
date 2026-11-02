"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";
import {
  formatRange,
  monthGrid,
  parseRange,
  RANGE_FROM_PARAM,
  RANGE_TO_PARAM,
  rangePresets,
  shiftMonth,
  todayKey,
  type DateRange,
} from "@/lib/ui/date-range";

const WEEKDAYS = ["S", "T", "Q", "Q", "S", "S", "D"];
const MONTH_LABEL = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });

/**
 * Calendário de período de cada aba. O período fica na URL, então sobrevive a
 * refresh e dá para mandar o link. Primeiro clique marca o início, o segundo
 * fecha o período.
 */
export function DateRangeFilter({ emptyLabel = "Todo o período" }: { emptyLabel?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const applied = parseRange(searchParams.get(RANGE_FROM_PARAM), searchParams.get(RANGE_TO_PARAM));
  const [open, setOpen] = useState(false);
  const [today, setToday] = useState("");
  const [month, setMonth] = useState("");
  const [draftStart, setDraftStart] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    if (!open) {
      const now = todayKey();
      setToday(now);
      setMonth((applied?.to ?? now).slice(0, 7));
      setDraftStart(null);
    }
    setOpen(!open);
  }

  function apply(range: DateRange | null) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(RANGE_FROM_PARAM);
    params.delete(RANGE_TO_PARAM);
    if (range) {
      params.set(RANGE_FROM_PARAM, range.from);
      params.set(RANGE_TO_PARAM, range.to);
    }
    const qs = params.toString();
    setOpen(false);
    setDraftStart(null);
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function pickDay(day: string) {
    if (!draftStart) {
      setDraftStart(day);
      return;
    }
    apply(parseRange(draftStart, day));
  }

  const shown: DateRange | null = draftStart ? { from: draftStart, to: draftStart } : applied;

  return (
    <div ref={root} className="relative inline-flex">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`flex h-11 items-center gap-2.5 rounded-[var(--radius-button)] border bg-surface-1 pl-3.5 text-sm font-medium transition-colors duration-[var(--motion-fast)] hover:border-border-strong ${
          applied ? "border-signal pr-11 text-text" : "border-border pr-4 text-text-secondary"
        }`}
      >
        <CalendarDays aria-hidden="true" className={`h-[18px] w-[18px] shrink-0 ${isPending || applied ? "text-signal" : "text-text-muted"}`} />
        <span className="whitespace-nowrap">{applied ? formatRange(applied) : emptyLabel}</span>
      </button>
      {applied && (
        <button
          type="button"
          onClick={() => apply(null)}
          aria-label="Limpar período"
          className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-[8px] text-text-muted transition-colors duration-[var(--motion-fast)] hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      )}

      {open && month && (
        <div
          role="dialog"
          aria-label="Escolher período"
          className="absolute left-0 top-[calc(100%+8px)] z-40 flex w-[min(92vw,520px)] flex-wrap rounded-[var(--radius-panel-lg)] border border-border bg-surface-elevated shadow-[var(--shadow-elevated)] data-[state=open]:animate-[panel-in_var(--motion-ui)_var(--ease-out)]"
        >
          <div className="flex flex-1 basis-[172px] flex-col gap-0.5 border-r border-border p-2">
            {rangePresets(today).map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => apply(preset.range)}
                className="h-10 rounded-[8px] px-3 text-left text-sm text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-surface-3 hover:text-text"
              >
                {preset.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => apply(null)}
              className="h-10 rounded-[8px] px-3 text-left text-sm text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-surface-3 hover:text-text"
            >
              Sem filtro de data
            </button>
          </div>

          <div className="flex-[999] basis-[300px] p-4">
            <div className="mb-3 flex items-center justify-between">
              <button
                type="button"
                aria-label="Mês anterior"
                onClick={() => setMonth(shiftMonth(month, -1))}
                className="grid h-9 w-9 place-items-center rounded-[8px] text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-surface-3 hover:text-text"
              >
                <ChevronLeft className="h-[18px] w-[18px]" />
              </button>
              <span className="font-semibold text-text first-letter:uppercase">{MONTH_LABEL.format(new Date(`${month}-01T12:00:00Z`))}</span>
              <button
                type="button"
                aria-label="Próximo mês"
                onClick={() => setMonth(shiftMonth(month, 1))}
                className="grid h-9 w-9 place-items-center rounded-[8px] text-text-secondary transition-colors duration-[var(--motion-fast)] hover:bg-surface-3 hover:text-text"
              >
                <ChevronRight className="h-[18px] w-[18px]" />
              </button>
            </div>

            <div className="grid grid-cols-7 gap-y-0.5 text-center">
              {WEEKDAYS.map((weekday, index) => (
                <span key={index} aria-hidden="true" className="pb-1 text-xs text-text-muted">
                  {weekday}
                </span>
              ))}
              {monthGrid(month)
                .flat()
                .map((day) => {
                  const inMonth = day.slice(0, 7) === month;
                  const isEdge = day === shown?.from || day === shown?.to;
                  const isInside = !!shown && day > shown.from && day < shown.to;
                  return (
                    <button
                      key={day}
                      type="button"
                      onClick={() => pickDay(day)}
                      aria-label={`${day.slice(8)}/${day.slice(5, 7)}/${day.slice(0, 4)}`}
                      aria-pressed={isEdge || isInside}
                      className={`h-10 rounded-[8px] text-sm tabular-nums transition-colors duration-[var(--motion-fast)] ${
                        isEdge
                          ? "bg-signal font-semibold text-signal-on"
                          : isInside
                            ? "bg-signal-soft text-text"
                            : `hover:bg-surface-3 ${inMonth ? "text-text" : "text-text-muted"} ${day === today ? "font-bold underline underline-offset-4" : ""}`
                      }`}
                    >
                      {Number(day.slice(8))}
                    </button>
                  );
                })}
            </div>

            <p className="mt-3 text-xs text-text-muted">{draftStart ? "Agora escolha o último dia." : "Escolha o primeiro dia."}</p>
          </div>
        </div>
      )}
    </div>
  );
}
