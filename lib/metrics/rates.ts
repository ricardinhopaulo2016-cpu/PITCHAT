import { NO_BASE_LABEL, NO_DATA_LABEL } from "./constants";

export type Rate = { kind: "value"; value: number } | { kind: "no_base" } | { kind: "pending"; pending: number };
export type Delta = { kind: "value"; percent: number } | { kind: "no_base" };

const number = new Intl.NumberFormat("pt-BR");

/** Sem dado ou denominador zero é "sem base", nunca 0%. */
export function rate(numerator: number | null, denominator: number | null): Rate {
  if (numerator === null || denominator === null || denominator === 0) return { kind: "no_base" };
  return { kind: "value", value: numerator / denominator };
}

export function delta(current: number | null, baseline: number | null): Delta {
  if (current === null || baseline === null || baseline === 0) return { kind: "no_base" };
  return { kind: "value", percent: ((current - baseline) / baseline) * 100 };
}

export function formatRate(r: Rate): string {
  if (r.kind === "no_base") return NO_BASE_LABEL;
  if (r.kind === "pending") return `${number.format(r.pending)} ${r.pending === 1 ? "pendente" : "pendentes"}`;
  if (r.value > 0 && r.value < 0.01) return "<1%";
  return `${Math.round(r.value * 100)}%`;
}

export function formatDelta(d: Delta): string {
  if (d.kind === "no_base") return NO_BASE_LABEL;
  const rounded = Math.round(d.percent);
  if (rounded === 0) return "0%";
  return `${rounded > 0 ? "+" : ""}${rounded}%`;
}

/** Nome vindo do banco pode ter o travessão longo, proibido na interface. */
export function displayName(name: string): string {
  return name.replace(/\s*—\s*/g, ", ");
}

export function formatCount(n: number | null): string {
  return n === null ? NO_DATA_LABEL : number.format(n);
}
