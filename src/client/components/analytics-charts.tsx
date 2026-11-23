import type { ReactNode } from "react";
import { cx } from "./ui";

export function StatTile({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: "brand" }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={cx("mt-1.5 text-2xl font-semibold tabular-nums", tone === "brand" ? "text-brand-600" : "text-zinc-900")}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-zinc-500">{hint}</p>}
    </div>
  );
}

export interface BarDatum {
  label: string;
  value: number;
  /** Shown in the native tooltip; defaults to "label: value". */
  title?: string;
}

/** Responsive vertical bar chart in plain SVG. Axis labels show first, middle and last points to stay legible on phones. */
export function BarChart({ data, ariaLabel, height = 180, formatValue = String }: { data: BarDatum[]; ariaLabel: string; height?: number; formatValue?: (v: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const width = 600;
  const top = 12;
  const bottom = 22;
  const plotH = height - top - bottom;
  const slot = width / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(36, slot * 0.7));
  const labelIdx = new Set([0, Math.floor((data.length - 1) / 2), data.length - 1]);
  const gridLines = [0, 0.5, 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} className="h-auto w-full" preserveAspectRatio="none">
      {gridLines.map((g) => {
        const y = top + plotH - g * plotH;
        return (
          <g key={g}>
            <line x1={0} x2={width} y1={y} y2={y} className="stroke-zinc-100" strokeWidth={1} />
            {g > 0 && (
              <text x={2} y={y - 3} className="fill-zinc-400" fontSize={10}>
                {formatValue(Math.round(max * g))}
              </text>
            )}
          </g>
        );
      })}
      {data.map((d, i) => {
        const h = (d.value / max) * plotH;
        const x = i * slot + (slot - barW) / 2;
        return (
          <g key={`${d.label}-${i}`}>
            <rect x={x} y={top + plotH - h} width={barW} height={Math.max(h, d.value > 0 ? 1.5 : 0)} rx={Math.min(3, barW / 3)} className="fill-brand-500">
              <title>{d.title ?? `${d.label}: ${formatValue(d.value)}`}</title>
            </rect>
            {/* Invisible full-height hit area so small bars still show a tooltip. */}
            <rect x={i * slot} y={top} width={slot} height={plotH} fill="transparent">
              <title>{d.title ?? `${d.label}: ${formatValue(d.value)}`}</title>
            </rect>
            {labelIdx.has(i) && (
              <text
                x={i * slot + slot / 2}
                y={height - 6}
                textAnchor={i === 0 ? "start" : i === data.length - 1 ? "end" : "middle"}
                className="fill-zinc-500"
                fontSize={11}
              >
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Horizontal labelled bars (good for small categorical breakdowns). */
export function BreakdownBars({ items, formatValue = String, emptyText = "No data yet" }: { items: { label: string; value: number }[]; formatValue?: (v: number) => string; emptyText?: string }) {
  const total = items.reduce((s, i) => s + i.value, 0);
  if (!total) return <p className="text-sm text-zinc-500">{emptyText}</p>;
  const max = Math.max(...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-zinc-700">{i.label}</span>
            <span className="tabular-nums text-zinc-500">
              {formatValue(i.value)} <span className="text-xs">({Math.round((i.value / total) * 100)}%)</span>
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-zinc-100" aria-hidden>
            <div className="h-full rounded-full bg-brand-500" style={{ width: `${(i.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const pct = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, (used / limit) * 100);
  const tone = limit !== null && pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-brand-500";
  return (
    <div>
      <div className="mb-1 flex justify-between gap-2 text-sm">
        <span className="text-zinc-700">{label}</span>
        <span className="tabular-nums text-zinc-500">
          {used.toLocaleString("en-IN")} / {limit === null ? "Unlimited" : limit.toLocaleString("en-IN")}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-zinc-100"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={limit ?? undefined}
        aria-valuenow={used}
      >
        {limit !== null && <div className={cx("h-full rounded-full", tone)} style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}
