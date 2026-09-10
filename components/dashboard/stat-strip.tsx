/**
 * "Stat strip" assimétrica, não três cards idênticos (docs/PITCHAT_DESIGN_SYSTEM.md,
 * seção 22 do briefing). Só dados reais — nunca inventar métrica.
 */
export function StatStrip({
  stats,
}: {
  stats: { label: string; value: number | string; tone?: "default" | "danger" }[];
}) {
  return (
    <div className="flex flex-wrap divide-x divide-border-subtle rounded-[var(--radius-panel-lg)] border border-border-subtle bg-surface-1">
      {stats.map((stat) => (
        <div key={stat.label} className="min-w-[140px] flex-1 px-5 py-4">
          <div
            className="text-2xl font-semibold tracking-[-0.02em]"
            style={{ color: stat.tone === "danger" && Number(stat.value) > 0 ? "var(--danger)" : "var(--text)" }}
          >
            {stat.value}
          </div>
          <div className="mt-0.5 text-sm text-text-secondary">{stat.label}</div>
        </div>
      ))}
    </div>
  );
}
