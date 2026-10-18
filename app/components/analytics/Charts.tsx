import { type PointerEvent, type ReactNode, useId, useState } from "react";
import type { Interval } from "@slopperday/analytics/shared/insights";
import { formatBucket, formatCount } from "~/lib/insights";

/**
 * The charts on /analytics, drawn as SVG and HTML with Slopper's tokens.
 * Series take `--series-1` to `--series-4` in that order (app/app.css); text
 * stays in ink. Every chart has a hover read-out and a table behind it.
 */

export const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? "var(--series-1)";
}

/** A round number at or above `value`, for an axis top: 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceCeiling(value: number): number {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((multiple) => multiple * power >= value) ?? 10;
  return step * power;
}

/** Which bucket labels to show: about `count` of them, evenly spaced, always the first and last. */
export function labelIndexes(length: number, count = 6): number[] {
  if (length <= count) return Array.from({ length }, (_, index) => index);
  const step = (length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => Math.round(index * step));
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  if (items.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-2">
          <span aria-hidden className="inline-block h-1 w-4 rounded-full" style={{ background: item.color }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** The numbers behind a chart, folded away until asked for. */
export function DataTable({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <details className="mt-3 text-sm">
      <summary className="cursor-pointer text-muted">Show as a table</summary>
      <div className="mt-2 max-h-80 overflow-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} scope="col" className="border-b border-line py-1 pr-4 font-bold">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="border-b border-line py-1 pr-4 tabular-nums">
                    {typeof cell === "number" ? formatCount(cell) : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

const WIDTH = 640;
const PADDING = { top: 12, right: 12, bottom: 28, left: 44 };

export interface LineSeries {
  label: string;
  values: number[];
}

/**
 * Lines over time on one axis (one unit: counts). A crosshair follows the
 * pointer and reads out every line at that bucket.
 */
export function LineChart({
  buckets,
  interval,
  series,
  height = 220,
  title,
}: {
  buckets: number[];
  interval: Interval;
  series: LineSeries[];
  height?: number;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const max = niceCeiling(Math.max(0, ...series.flatMap((line) => line.values)));
  const x = (index: number) =>
    PADDING.left + (buckets.length <= 1 ? plotWidth / 2 : (index / (buckets.length - 1)) * plotWidth);
  const y = (value: number) => PADDING.top + plotHeight - (value / max) * plotHeight;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((share) => share * max);

  function onMove(event: PointerEvent<SVGRectElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const share = (event.clientX - box.left) / box.width;
    setHover(Math.max(0, Math.min(buckets.length - 1, Math.round(share * (buckets.length - 1)))));
  }

  const active = hover === null ? undefined : buckets[hover];
  return (
    <figure className="grid gap-3">
      <Legend items={series.map((line, index) => ({ label: line.label, color: seriesColor(index) }))} />
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${height}`}
          className="block w-full overflow-visible"
          role="img"
          aria-label={`${title}: ${series.map((line) => `${line.label}, ${formatCount(line.values.reduce((sum, value) => sum + value, 0))} in all`).join("; ")}`}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line x1={PADDING.left} x2={WIDTH - PADDING.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" />
              <text x={PADDING.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">
                {formatCount(tick)}
              </text>
            </g>
          ))}
          {labelIndexes(buckets.length).map((index) => (
            <text
              key={index}
              x={x(index)}
              y={height - 8}
              textAnchor={index === 0 ? "start" : index === buckets.length - 1 ? "end" : "middle"}
              className="fill-muted text-[11px]"
            >
              {formatBucket(buckets[index] ?? 0, interval)}
            </text>
          ))}
          {series.map((line, index) => (
            <polyline
              key={line.label}
              fill="none"
              stroke={seriesColor(index)}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              points={line.values.map((value, bucket) => `${x(bucket)},${y(value)}`).join(" ")}
            />
          ))}
          {hover !== null && (
            <g>
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={PADDING.top}
                y2={PADDING.top + plotHeight}
                stroke="var(--line-strong)"
              />
              {series.map((line, index) => (
                <circle
                  key={line.label}
                  cx={x(hover)}
                  cy={y(line.values[hover] ?? 0)}
                  r={4}
                  fill={seriesColor(index)}
                  stroke="var(--raised)"
                  strokeWidth={2}
                />
              ))}
            </g>
          )}
          <rect
            x={PADDING.left}
            y={PADDING.top}
            width={plotWidth}
            height={plotHeight}
            fill="transparent"
            onPointerMove={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        {hover !== null && active !== undefined && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-raised px-3 py-2 text-sm shadow-lg"
            style={{
              left: `${(x(hover) / WIDTH) * 100}%`,
              transform: hover > buckets.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
          >
            <p className="font-bold">{formatBucket(active, interval)}</p>
            {series.map((line, index) => (
              <p key={line.label} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block size-2 rounded-full"
                    style={{ background: seriesColor(index) }}
                  />
                  {line.label}
                </span>
                <span className="tabular-nums">{formatCount(line.values[hover] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <DataTable
        caption={title}
        columns={["Period", ...series.map((line) => line.label)]}
        rows={buckets.map((bucket, index) => [
          formatBucket(bucket, interval),
          ...series.map((line) => line.values[index] ?? 0),
        ])}
      />
    </figure>
  );
}

export interface ColumnStack {
  label: string;
  values: number[];
  color: string;
}

/**
 * Columns, stacked when there's more than one series. Negative values
 * stack below the baseline (lifecycle's dormant people). Hovering a column
 * reads it out.
 */
export function ColumnChart({
  labels,
  stacks,
  height = 220,
  title,
}: {
  labels: string[];
  stacks: ColumnStack[];
  height?: number;
  title: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const plotWidth = WIDTH - PADDING.left - PADDING.right;
  const plotHeight = height - PADDING.top - PADDING.bottom;
  const up = labels.map((_, index) => stacks.reduce((sum, stack) => sum + Math.max(0, stack.values[index] ?? 0), 0));
  const down = labels.map((_, index) => stacks.reduce((sum, stack) => sum + Math.min(0, stack.values[index] ?? 0), 0));
  const top = niceCeiling(Math.max(0, ...up));
  const bottom = Math.min(0, ...down) < 0 ? -niceCeiling(-Math.min(...down)) : 0;
  const span = top - bottom;
  const y = (value: number) => PADDING.top + ((top - value) / span) * plotHeight;
  const slot = plotWidth / Math.max(1, labels.length);
  const barWidth = Math.max(4, Math.min(48, slot - 4));
  const ticks = bottom < 0 ? [bottom, bottom / 2, 0, top / 2, top] : [0, top / 4, top / 2, (3 * top) / 4, top];

  return (
    <figure className="grid gap-3">
      <Legend items={stacks.map((stack) => ({ label: stack.label, color: stack.color }))} />
      <div className="relative">
        <svg viewBox={`0 0 ${WIDTH} ${height}`} className="block w-full overflow-visible" role="img" aria-label={title}>
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={PADDING.left}
                x2={WIDTH - PADDING.right}
                y1={y(tick)}
                y2={y(tick)}
                stroke={tick === 0 ? "var(--line-strong)" : "var(--line)"}
              />
              <text x={PADDING.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px]">
                {formatCount(tick)}
              </text>
            </g>
          ))}
          {labels.map((label, index) => {
            const center = PADDING.left + slot * index + slot / 2;
            let above = 0;
            let below = 0;
            return (
              <g
                key={label}
                onPointerEnter={() => setHover(index)}
                onPointerLeave={() => setHover(null)}
                opacity={hover === null || hover === index ? 1 : 0.55}
              >
                <rect x={center - slot / 2} y={PADDING.top} width={slot} height={plotHeight} fill="transparent" />
                {stacks.map((stack) => {
                  const value = stack.values[index] ?? 0;
                  if (value === 0) return null;
                  const from = value > 0 ? above : below;
                  const to = from + value;
                  if (value > 0) above = to;
                  else below = to;
                  const yTop = y(Math.max(from, to));
                  // A 2px gap between stacked pieces, in the surface color.
                  const h = Math.max(1, Math.abs(y(from) - y(to)) - 2);
                  return (
                    <rect
                      key={stack.label}
                      x={center - barWidth / 2}
                      y={value > 0 ? yTop + 2 : yTop}
                      width={barWidth}
                      height={h}
                      rx={Math.min(4, barWidth / 4)}
                      fill={stack.color}
                    />
                  );
                })}
              </g>
            );
          })}
          {labelIndexes(labels.length, 8).map((index) => (
            <text
              key={index}
              x={PADDING.left + slot * index + slot / 2}
              y={height - 8}
              textAnchor="middle"
              className="fill-muted text-[11px]"
            >
              {labels[index]}
            </text>
          ))}
        </svg>
        {hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 min-w-36 rounded-lg border border-line bg-raised px-3 py-2 text-sm shadow-lg"
            style={{
              left: `${((PADDING.left + slot * hover + slot / 2) / WIDTH) * 100}%`,
              transform: hover > labels.length / 2 ? "translateX(calc(-100% - 12px))" : "translateX(12px)",
            }}
          >
            <p className="font-bold">{labels[hover]}</p>
            {stacks.map((stack) => (
              <p key={stack.label} className="flex items-center justify-between gap-4">
                <span className="flex items-center gap-2">
                  <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: stack.color }} />
                  {stack.label}
                </span>
                <span className="tabular-nums">{formatCount(stack.values[hover] ?? 0)}</span>
              </p>
            ))}
          </div>
        )}
      </div>
      <DataTable
        caption={title}
        columns={["", ...stacks.map((stack) => stack.label)]}
        rows={labels.map((label, index) => [label, ...stacks.map((stack) => stack.values[index] ?? 0)])}
      />
    </figure>
  );
}

export interface BarRow {
  key: string;
  label: ReactNode;
  value: number;
  /** A second number in muted ink, like unique visitors next to page views. */
  detail?: string;
}

/** A ranked list with a bar behind each row, for breakdowns. */
export function BarList({ rows, empty = "Nothing yet." }: { rows: BarRow[]; empty?: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="grid gap-1">
      {rows.map((row) => (
        <li key={row.key} className="relative flex items-center justify-between gap-3 px-2 py-1 text-sm">
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-sm bg-slop-tint"
            style={{ width: `${(row.value / max) * 100}%` }}
          />
          <span className="relative min-w-0 truncate">{row.label}</span>
          <span className="relative shrink-0 tabular-nums">
            {formatCount(row.value)}
            {row.detail && <span className="ml-2 text-muted">{row.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A panel with a small heading, for the dashboard grid. */
export function ChartPanel({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  const id = useId();
  return (
    <section className="panel grid content-start gap-4" aria-labelledby={id}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={id} className="font-display text-xl font-extrabold">
          {title}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** A headline number: its label, the number, and a line of context under it. */
export function Stat({
  label,
  value,
  previous,
  hint,
}: {
  label: string;
  value: string;
  previous?: string | null;
  hint?: string;
}) {
  return (
    <div className="panel grid content-start gap-1">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-display text-[2.25rem] leading-none font-extrabold tabular-nums">{value}</p>
      {previous !== undefined && <p className="text-sm text-muted">{previous ?? "Nothing to compare with"}</p>}
      {hint && <p className="text-sm text-muted">{hint}</p>}
    </div>
  );
}
