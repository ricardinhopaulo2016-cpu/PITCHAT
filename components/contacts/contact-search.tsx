"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

const DEBOUNCE_MS = 250;

/** Busca por @username. Fica na URL (`?q=`), para sobreviver a refresh, voltar e troca de perfil. */
export function ContactSearch() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(searchParams.get("q") ?? "");
  const [isPending, startTransition] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function apply(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set("q", next.trim());
    else params.delete("q");
    const qs = params.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  function handleChange(next: string) {
    setValue(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => apply(next), DEBOUNCE_MS);
  }

  function clear() {
    if (timer.current) clearTimeout(timer.current);
    setValue("");
    apply("");
  }

  return (
    <form
      role="search"
      className="relative w-full max-w-[420px]"
      onSubmit={(e) => {
        e.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        apply(value);
      }}
    >
      <Search aria-hidden="true" className={`pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 ${isPending ? "text-signal" : "text-text-muted"}`} />
      <input
        type="search"
        aria-label="Buscar contato por @"
        placeholder="Buscar por @"
        autoComplete="off"
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        className="h-11 w-full rounded-[var(--radius-input)] border border-border bg-surface-1 pl-11 pr-11 text-sm text-text transition-colors duration-[var(--motion-fast)] placeholder:text-text-muted focus-visible:border-signal focus-visible:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={clear}
          aria-label="Limpar busca"
          className="absolute right-1 top-1 grid h-9 w-9 place-items-center rounded-[8px] text-text-muted transition-colors duration-[var(--motion-fast)] hover:text-text"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </form>
  );
}
