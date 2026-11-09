import { axisTicks, chartX, chartY, isolatedIndexes, linePath, niceCeil, tooltipSide, xTickIndexes, type TooltipSide } from "@/lib/metrics/chart";
import { NO_BASE_LABEL } from "@/lib/metrics/constants";
import { formatCount } from "@/lib/metrics/rates";

export type ChartSeries = { key: string; label: string; color: string; values: (number | null)[] };

const SVG_LINE = { fill: "none", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", vectorEffect: "non-scaling-stroke" } as const;
const TOOLTIP = "pointer-events-none absolute z-10 hidden w-max max-w-48 rounded-[var(--radius-panel-sm)] border border-border bg-surface-elevated px-2.5 py-2 text-xs shadow-[var(--shadow-elevated)] group-hover:block group-focus:block";

const TOOLTIP_SIDE: Record<TooltipSide, string> = { right: "left-1/2 ml-2", center: "left-1/2 -translate-x-1/2", left: "right-1/2 mr-2" };
const FUTURE_HATCH = "repeating-linear-gradient(135deg, var(--surface-3) 0 2px, transparent 2px 6px)";
const NARROW_TICKS = 4;

function shortDay(day: string): string {
  return `${day.slice(8)}/${day.slice(5, 7)}`;
}

function Legend({ series }: { series: ChartSeries[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
      {series.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function Dot({ x, y, color, faint }: { x: number; y: number; color: string; faint?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-surface-1"
      style={{ left: `${x}%`, top: `${y}%`, background: faint ? "var(--surface-1)" : color, boxShadow: faint ? `inset 0 0 0 2px ${color}` : undefined }}
    />
  );
}

function DayAxis({ days, maxTicks, className }: { days: string[]; maxTicks?: number; className: string }) {
  const ticks = new Set(xTickIndexes(days.length, maxTicks));
  return (
    <div className={`pl-9 text-xs tabular-nums text-text-muted ${className}`} aria-hidden="true">
      {days.map((day, index) => (
        <span key={day} className="flex min-w-0 flex-1 justify-center overflow-visible whitespace-nowrap">
          {ticks.has(index) ? shortDay(day) : ""}
        </span>
      ))}
    </div>
  );
}

/**
 * Linhas por dia sem biblioteca. O SVG estica com `preserveAspectRatio="none"`
 * e o traço não deforma; textos, pontos e dicas são HTML por cima, para não esticarem.
 * Se o último dia está em andamento, o trecho final fica apagado: queda ali ainda não é queda.
 */
export function DailyLineChart({ days, series, lastIsPartial, description }: { days: string[]; series: ChartSeries[]; lastIsPartial: boolean; description: string }) {
  const count = days.length;
  const known = series.flatMap((item) => item.values).filter((value): value is number => value !== null);
  const ceiling = niceCeil(Math.max(0, ...known));

  return (
    <div className="@container flex flex-col gap-3 px-5 py-4">
      <Legend series={series} />
      <div role="img" aria-label={description} className="relative h-48 pl-9">
        <div className="relative h-full">
          {axisTicks(ceiling).map((tick) => (
            <div key={tick} className="absolute inset-x-0 border-t border-border-subtle" style={{ top: `${chartY(tick, ceiling)}%` }}>
              <span className="absolute -left-9 -translate-y-1/2 text-xs tabular-nums text-text-muted">{formatCount(tick)}</span>
            </div>
          ))}

          <svg aria-hidden="true" viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full overflow-visible">
            {series.map((item) => {
              const solid = lastIsPartial ? item.values.map((value, index) => (index === count - 1 ? null : value)) : item.values;
              const partial = lastIsPartial ? linePath(item.values.map((value, index) => (index >= count - 2 ? value : null)), ceiling) : "";
              return (
                <g key={item.key}>
                  <path d={linePath(solid, ceiling)} stroke={item.color} {...SVG_LINE} />
                  {partial && <path d={partial} stroke={item.color} opacity={0.4} {...SVG_LINE} />}
                </g>
              );
            })}
          </svg>

          {series.flatMap((item) => {
            const last = item.values.findLastIndex((value) => value !== null);
            const marks = new Set([...isolatedIndexes(item.values), ...(last >= 0 ? [last] : [])]);
            return [...marks].map((index) => <Dot key={`${item.key}-${index}`} x={chartX(index, count)} y={chartY(item.values[index] as number, ceiling)} color={item.color} faint={lastIsPartial && index === count - 1} />);
          })}

          <div className="absolute inset-0 flex">
            {days.map((day, index) => (
              <div key={day} tabIndex={-1} className="group relative flex-1 outline-none">
                <span aria-hidden="true" className="absolute inset-y-0 left-1/2 hidden w-px bg-border-strong group-hover:block group-focus:block" />
                <div className={`${TOOLTIP} top-1 ${TOOLTIP_SIDE[tooltipSide(index, count)]}`}>
                  <p className="mb-1 text-text-muted">
                    {shortDay(day)}
                    {lastIsPartial && index === count - 1 ? ", parcial" : ""}
                  </p>
                  <ul className="flex flex-col gap-0.5">
                    {series.map((item) => (
                      <li key={item.key} className="flex items-center gap-1.5 whitespace-nowrap">
                        <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ background: item.color }} />
                        {item.values[index] === null ? (
                          <span className="text-text-muted">{`${item.label}: ${NO_BASE_LABEL}`}</span>
                        ) : (
                          <>
                            <span className="font-semibold tabular-nums text-text">{formatCount(item.values[index])}</span>
                            <span className="text-text-muted">{item.label}</span>
                          </>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <DayAxis days={days} maxTicks={NARROW_TICKS} className="flex @sm:hidden" />
      <DayAxis days={days} className="hidden @sm:flex" />
    </div>
  );
}

export type HourColumn = { hourOfDay: number; total: number; future: boolean };

function hourLabel(hourOfDay: number): string {
  return `${String(hourOfDay).padStart(2, "0")}h`;
}

function hourText(column: HourColumn): string {
  return column.future ? "ainda não chegou" : `${formatCount(column.total)} ${column.total === 1 ? "mensagem" : "mensagens"}`;
}

/** Colunas por hora. Só o pico leva a cor de destaque. */
export function HourColumns({ columns, description }: { columns: HourColumn[]; description: string }) {
  const max = Math.max(...columns.map((column) => column.total));
  const peak = columns.find((column) => column.total === max);
  return (
    <div className="flex flex-col gap-1 px-5 py-4">
      <div role="img" aria-label={description} className="flex h-48 items-end gap-0.5 border-b border-border-subtle">
        {columns.map((column, index) => {
          const hour = hourLabel(column.hourOfDay);
          const isPeak = column === peak;
          return (
            <div key={hour} tabIndex={-1} className="group relative flex h-full flex-1 items-end outline-none">
              {column.future && <div aria-hidden="true" className="absolute inset-0 rounded-t-[4px]" style={{ background: FUTURE_HATCH }} />}
              {column.total > 0 && <div className={`min-h-0.5 w-full rounded-t-[4px] transition-colors duration-[var(--motion-fast)] ${isPeak ? "bg-signal" : "bg-info/60 group-hover:bg-info"}`} style={{ height: `${(column.total / max) * 100}%` }} />}
              <div className={`${TOOLTIP} top-1 whitespace-nowrap text-text ${index < columns.length / 2 ? "left-0" : "right-0"}`}>{`${hour}: ${hourText(column)}`}</div>
            </div>
          );
        })}
      </div>
      <div className="grid grid-cols-4 text-xs text-text-muted" aria-hidden="true">
        {["00h", "06h", "12h", "18h"].map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {columns.some((column) => column.future) && (
        <p className="mt-1 flex items-center gap-1.5 text-xs text-text-muted">
          <span aria-hidden="true" className="h-3 w-3 rounded-[3px]" style={{ background: FUTURE_HATCH }} />
          Ainda não chegou
        </p>
      )}
      <details className="mt-2 border-t border-border-subtle pt-2">
        <summary className="cursor-pointer text-xs text-text-secondary transition-colors duration-[var(--motion-fast)] hover:text-text">Ver valores por hora</summary>
        <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
          {columns.map((column) => (
            <div key={column.hourOfDay} className="flex items-baseline justify-between gap-2">
              <dt className="text-text-muted">{hourLabel(column.hourOfDay)}</dt>
              <dd className={`tabular-nums ${column.future ? "text-text-muted" : "text-text-secondary"}`}>{column.future ? "ainda não chegou" : formatCount(column.total)}</dd>
            </div>
          ))}
        </dl>
      </details>
    </div>
  );
}
