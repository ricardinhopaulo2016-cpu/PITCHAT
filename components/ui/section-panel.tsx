import type { ReactNode } from "react";

export function Stat({ label, value, color, caption }: { label: string; value: number | string; color?: string; caption?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 border-r border-border-subtle px-4 py-3 last:border-r-0">
      <span className="font-mono text-xl font-medium tabular-nums" style={{ color: color ?? "var(--text)" }}>
        {value}
      </span>
      <span className="text-xs text-text-muted">{label}</span>
      {caption && <span className="text-xs text-text-muted">{caption}</span>}
    </div>
  );
}

export function SectionPanel({ title, children, caption, id }: { title: string; children: ReactNode; caption?: string; id?: string }) {
  return (
    <div id={id} className="overflow-hidden rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
      <div className="border-b border-border-subtle bg-surface-1 px-5 py-2.5">
        <p className="text-lg font-semibold text-text">{title}</p>
        {caption && <p className="mt-0.5 text-xs text-text-muted">{caption}</p>}
      </div>
      {children}
    </div>
  );
}
