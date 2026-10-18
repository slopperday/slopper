import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { BarSeriesOption, LineSeriesOption, SankeySeriesOption } from "echarts/charts";
import type {
  DataZoomComponentOption,
  GridComponentOption,
  LegendComponentOption,
  TooltipComponentOption,
} from "echarts/components";
import type { ComposeOption, ECharts } from "echarts/core";
import { useReducedMotion } from "~/lib/motion";

/**
 * One chart, drawn by ECharts once it's on screen: the library loads in its
 * own chunk the first time a chart mounts, so pages without charts never
 * fetch it, and the space the chart takes is held from the first render.
 * Colours and type come from Slopper's tokens in either theme, and charts
 * animate unless motion is turned down (app/lib/motion.ts).
 */

export type ChartOption = ComposeOption<
  | LineSeriesOption
  | BarSeriesOption
  | SankeySeriesOption
  | GridComponentOption
  | TooltipComponentOption
  | LegendComponentOption
  | DataZoomComponentOption
>;

/** Slopper's tokens as plain colours ECharts can mix. */
export interface ChartTheme {
  ink: string;
  muted: string;
  line: string;
  lineStrong: string;
  raised: string;
  sunk: string;
  series: readonly [string, string, string, string];
  font: string;
}

const SERIES_TOKENS = ["--series-1", "--series-2", "--series-3", "--series-4"] as const;

/** A CSS colour (hex, modern rgb) as the browser normalises it: "#rrggbb" or "rgba(r, g, b, a)". */
function normalize(context: CanvasRenderingContext2D, value: string): string {
  context.fillStyle = "#000";
  context.fillStyle = value;
  return context.fillStyle;
}

let cached: { key: string; theme: ChartTheme } | null = null;

function readTheme(): ChartTheme {
  const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const key = dark ? "dark" : "light";
  if (cached?.key === key) return cached.theme;
  const style = getComputedStyle(document.documentElement);
  const context = document.createElement("canvas").getContext("2d");
  const token = (name: string) => {
    const value = style.getPropertyValue(name).trim();
    return context ? normalize(context, value) : value;
  };
  const theme: ChartTheme = {
    ink: token("--ink"),
    muted: token("--muted"),
    line: token("--line"),
    lineStrong: token("--line-strong"),
    raised: token("--raised"),
    sunk: token("--sunk"),
    series: [token(SERIES_TOKENS[0]), token(SERIES_TOKENS[1]), token(SERIES_TOKENS[2]), token(SERIES_TOKENS[3])],
    font: getComputedStyle(document.body).fontFamily,
  };
  cached = { key, theme };
  return theme;
}

function subscribeTheme(onChange: () => void): () => void {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** The chart colours for the theme on screen; null while rendering on the server. */
export function useChartTheme(): ChartTheme | null {
  return useSyncExternalStore(subscribeTheme, readTheme, () => null);
}

/** What every chart shares: Slopper's type and ink, a plain tooltip, and how it moves. */
function baseOption(theme: ChartTheme, still: boolean): ChartOption {
  return {
    animation: !still,
    animationDuration: 700,
    animationEasing: "cubicOut",
    animationDurationUpdate: 450,
    animationEasingUpdate: "cubicInOut",
    textStyle: { fontFamily: theme.font, color: theme.ink },
    tooltip: {
      backgroundColor: theme.raised,
      borderColor: theme.lineStrong,
      borderWidth: 1,
      padding: [8, 12],
      textStyle: { color: theme.ink, fontFamily: theme.font, fontSize: 13 },
      extraCssText: "border-radius: 12px; box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);",
    },
  };
}

export function EChart({
  option,
  height,
  label,
}: {
  /** Built with `useChartTheme`'s colours; null until there's a theme. */
  option: ChartOption | null;
  height: number;
  /** What the chart shows, for screen readers; its numbers are in the table beside it. */
  label: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<ECharts | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const still = useReducedMotion();
  const theme = useChartTheme();

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    let observer: ResizeObserver | null = null;
    import("./echarts.client")
      .then(({ init }) => {
        if (cancelled) return;
        const instance = init(element, null, { renderer: "svg" });
        chart.current = instance;
        observer = new ResizeObserver(() => instance.resize());
        observer.observe(element);
        setReady(true);
      })
      .catch((error: unknown) => {
        console.error("The chart didn't load.", error);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      chart.current?.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    if (!ready || !option || !theme || !chart.current) return;
    chart.current.setOption({ ...baseOption(theme, still), ...option }, { notMerge: true });
  }, [ready, option, theme, still]);

  return (
    <div className="relative w-full" style={{ height }} role="img" aria-label={label}>
      <div ref={host} className="absolute inset-0" />
      {!ready && (
        <div className="absolute inset-0 grid place-items-center rounded-lg bg-sunk/40 text-sm text-muted">
          {failed ? "The chart didn't load: its numbers are in the table." : ""}
        </div>
      )}
    </div>
  );
}
