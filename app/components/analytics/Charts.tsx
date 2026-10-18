import { type ReactNode, useId, useMemo } from "react";
import type { BarSeriesOption, LineSeriesOption } from "echarts/charts";
import type { Interval } from "@slopperday/analytics/shared/insights";
import { formatBucket, formatCount } from "~/lib/insights";
import { type ChartOption, EChart, useChartTheme } from "./EChart";

/**
 * The charts on /analytics and makers' slop analytics. Lines and columns are
 * ECharts (EChart.tsx: loaded once a chart is on screen, animated unless
 * motion is turned down); ranked lists are HTML. Series take `--series-1`
 * to `--series-4` in that order (app/app.css); text stays in ink. Every
 * chart has a read-out on hover and a table behind it.
 */

export const SERIES_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"] as const;

export function seriesColor(index: number): string {
  return SERIES_COLORS[index % SERIES_COLORS.length] ?? "var(--series-1)";
}

/**
 * Ticks for an axis of counts up to `max`: about four steps of 1, 2 or 5
 * times a power of ten, never a fraction, from 0 to the first tick at or
 * above `max`.
 */
export function axisTicks(max: number, steps = 4): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / steps;
  const power = 10 ** Math.floor(Math.log10(rough));
  const step = Math.max(1, ([1, 2, 5, 10].find((multiple) => multiple * power >= rough) ?? 10) * power);
  const top = Math.ceil(max / step) * step;
  return Array.from({ length: Math.round(top / step) + 1 }, (_, index) => index * step);
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

export interface LineSeries {
  label: string;
  values: number[];
  /** The period before, bucket by bucket, drawn dashed in the same colour to compare against. */
  previous?: number[];
}

/** Text from data (a path, a page title) as it may go into a tooltip's HTML. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => `&#${character.charCodeAt(0)};`);
}

/** A normalised colour ("#rrggbb" or "rgba(…)") at another opacity. */
export function withAlpha(color: string, alpha: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(color)?.[1];
  if (hex) {
    const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color.replace(/rgba?\(([^,]+),([^,]+),([^,)]+)(,[^)]*)?\)/, `rgba($1,$2,$3, ${alpha})`);
}

/** "▲ 12%" against the period before, or nothing when there's nothing to compare. */
export function changeLabel(current: number, previous: number | undefined): string {
  if (previous === undefined) return "";
  if (previous === 0) return current === 0 ? "" : "new";
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return "same";
  return `${change > 0 ? "▲" : "▼"} ${Math.round(Math.abs(change) * 100)}%`;
}

function swatch(color: string, dashed = false): string {
  const border = dashed ? `border-top: 2px dashed ${color}; height: 0;` : `background: ${color}; height: 4px;`;
  return `<span style="display:inline-block;width:14px;${border}border-radius:2px;margin-right:8px;vertical-align:middle"></span>`;
}

/** Long ranges zoom with ctrl + wheel or a pinch, and drag sideways; the page still scrolls normally. */
const ZOOM_FROM = 60;

/**
 * Lines over time on one axis (one unit: counts). The crosshair reads out
 * every line at that moment, against the period before when there is one;
 * the legend turns lines on and off.
 */
export function LineChart({
  buckets,
  interval,
  series,
  height = 260,
  title,
  compareLabel = "the period before",
}: {
  buckets: number[];
  interval: Interval;
  series: LineSeries[];
  height?: number;
  title: string;
  /** What the dashed lines are, in words: "the 30 days before". */
  compareLabel?: string;
}) {
  const theme = useChartTheme();
  const option = useMemo((): ChartOption | null => {
    if (!theme) return null;
    const labels = buckets.map((bucket) => formatBucket(bucket, interval));
    const comparing = series.some((line) => line.previous);
    const lines: LineSeriesOption[] = series.flatMap((line, index) => {
      const color = theme.series[index % theme.series.length] ?? theme.ink;
      const main: LineSeriesOption = {
        type: "line",
        name: line.label,
        data: line.values,
        smooth: 0.2,
        symbol: "circle",
        symbolSize: 8,
        showSymbol: buckets.length <= 31,
        lineStyle: { width: 2, color },
        itemStyle: { color, borderColor: theme.raised, borderWidth: 2 },
        emphasis: { focus: "series" },
        z: 3,
        ...(series.length === 1
          ? {
              areaStyle: {
                color: {
                  type: "linear",
                  x: 0,
                  y: 0,
                  x2: 0,
                  y2: 1,
                  colorStops: [
                    { offset: 0, color: withAlpha(color, 0.22) },
                    { offset: 1, color: withAlpha(color, 0) },
                  ],
                },
              },
            }
          : {}),
      };
      if (!line.previous) return [main];
      const before: LineSeriesOption = {
        type: "line",
        name: `${line.label}, ${compareLabel}`,
        data: line.previous,
        smooth: 0.2,
        symbol: "none",
        lineStyle: { width: 1.5, type: "dashed", color: withAlpha(color, 0.6) },
        itemStyle: { color: withAlpha(color, 0.6) },
        emphasis: { focus: "series" },
        z: 2,
      };
      return [main, before];
    });
    return {
      grid: {
        left: 4,
        right: 12,
        top: comparing || series.length > 1 ? 40 : 12,
        bottom: 4,
        outerBoundsMode: "same",
        outerBoundsContain: "axisLabel",
      },
      legend:
        comparing || series.length > 1
          ? {
              type: "scroll",
              top: 0,
              left: 0,
              right: 0,
              icon: "roundRect",
              pageIconColor: theme.ink,
              pageIconInactiveColor: theme.line,
              pageTextStyle: { color: theme.muted },
              itemWidth: 14,
              itemHeight: 4,
              itemGap: 18,
              textStyle: { color: theme.ink, fontFamily: theme.font, fontSize: 13 },
              inactiveColor: theme.muted,
            }
          : { show: false },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "line", lineStyle: { color: theme.lineStrong, width: 1 } },
        formatter: (params: unknown) => {
          const first = Array.isArray(params) ? params[0] : params;
          const position =
            typeof first === "object" && first !== null && "dataIndex" in first && typeof first.dataIndex === "number"
              ? first.dataIndex
              : 0;
          const rows = series.map((line, index) => {
            const color = theme.series[index % theme.series.length] ?? theme.ink;
            const value = line.values[position] ?? 0;
            const before = line.previous?.[position];
            const change = changeLabel(value, before);
            return `<div style="display:flex;align-items:center;gap:12px;justify-content:space-between">
              <span>${swatch(color)}${escapeHtml(line.label)}</span>
              <strong style="font-variant-numeric:tabular-nums">${formatCount(value)}</strong>
            </div>${
              before === undefined
                ? ""
                : `<div style="display:flex;gap:12px;justify-content:space-between;color:${theme.muted};font-size:12px">
              <span>${swatch(withAlpha(color, 0.6), true)}${escapeHtml(compareLabel)}: ${formatCount(before)}</span>
              <span>${change}</span>
            </div>`
            }`;
          });
          return `<div style="font-weight:700;margin-bottom:6px">${escapeHtml(labels[position] ?? "")}</div>${rows.join("")}`;
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLine: { lineStyle: { color: theme.lineStrong } },
        axisTick: { show: false },
        axisLabel: { color: theme.muted, hideOverlap: true, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted, fontSize: 11, formatter: (value: number) => formatCount(value) },
      },
      ...(buckets.length > ZOOM_FROM
        ? { dataZoom: [{ type: "inside", zoomOnMouseWheel: "ctrl", moveOnMouseWheel: false, moveOnMouseMove: true }] }
        : {}),
      series: lines,
    };
  }, [theme, buckets, interval, series, compareLabel]);

  return (
    <figure className="grid gap-3">
      <EChart option={option} height={height} label={title} />
      <DataTable
        caption={title}
        columns={[
          "When",
          ...series.flatMap((line) => (line.previous ? [line.label, `${line.label}, ${compareLabel}`] : [line.label])),
        ]}
        rows={buckets.map((bucket, index) => [
          formatBucket(bucket, interval),
          ...series.flatMap((line) =>
            line.previous ? [line.values[index] ?? 0, line.previous[index] ?? 0] : [line.values[index] ?? 0],
          ),
        ])}
      />
    </figure>
  );
}

export interface ColumnStack {
  label: string;
  values: number[];
  /** Which of the four series colours (`--series-1` to `--series-4`) it wears, in order. */
  series: 0 | 1 | 2 | 3;
}

/**
 * Columns, stacked when there's more than one series. Negative values
 * stack below the baseline (lifecycle's dormant people). Hovering a column
 * reads every part of it out.
 */
export function ColumnChart({
  labels,
  stacks,
  height = 260,
  title,
}: {
  labels: string[];
  stacks: ColumnStack[];
  height?: number;
  title: string;
}) {
  const theme = useChartTheme();
  const option = useMemo((): ChartOption | null => {
    if (!theme) return null;
    const bars: BarSeriesOption[] = stacks.map((stack) => {
      const color = theme.series[stack.series] ?? theme.ink;
      return {
        type: "bar",
        name: stack.label,
        data: stack.values,
        stack: stacks.length > 1 ? "all" : undefined,
        barMaxWidth: 40,
        itemStyle: { color, borderColor: theme.raised, borderWidth: 1, borderRadius: 3 },
        emphasis: { focus: "series" },
      };
    });
    return {
      grid: {
        left: 4,
        right: 12,
        top: stacks.length > 1 ? 40 : 12,
        bottom: 4,
        outerBoundsMode: "same",
        outerBoundsContain: "axisLabel",
      },
      legend:
        stacks.length > 1
          ? {
              type: "scroll",
              top: 0,
              left: 0,
              right: 0,
              icon: "roundRect",
              pageIconColor: theme.ink,
              pageIconInactiveColor: theme.line,
              pageTextStyle: { color: theme.muted },
              itemWidth: 12,
              itemHeight: 12,
              itemGap: 18,
              textStyle: { color: theme.ink, fontFamily: theme.font, fontSize: 13 },
              inactiveColor: theme.muted,
            }
          : { show: false },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: withAlpha(theme.ink, 0.05) } },
        formatter: (params: unknown) => {
          const first = Array.isArray(params) ? params[0] : params;
          const position =
            typeof first === "object" && first !== null && "dataIndex" in first && typeof first.dataIndex === "number"
              ? first.dataIndex
              : 0;
          const rows = stacks.map(
            (stack) => `<div style="display:flex;align-items:center;gap:12px;justify-content:space-between">
              <span>${swatch(theme.series[stack.series] ?? theme.ink)}${escapeHtml(stack.label)}</span>
              <strong style="font-variant-numeric:tabular-nums">${formatCount(stack.values[position] ?? 0)}</strong>
            </div>`,
          );
          return `<div style="font-weight:700;margin-bottom:6px">${escapeHtml(labels[position] ?? "")}</div>${rows.join("")}`;
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: theme.lineStrong } },
        axisTick: { show: false },
        axisLabel: { color: theme.muted, hideOverlap: true, fontSize: 11 },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        splitLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted, fontSize: 11, formatter: (value: number) => formatCount(value) },
      },
      series: bars,
    };
  }, [theme, labels, stacks]);

  return (
    <figure className="grid gap-3">
      <EChart option={option} height={height} label={title} />
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
