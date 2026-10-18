import type {
  FunnelQuery,
  FunnelResult,
  Interval,
  LifecycleResult,
  PathsResult,
  RetentionResult,
  StickinessResult,
  TrendsResult,
} from "@slopperday/analytics/shared/insights";
import { eventLabel, formatBucket, formatCount, formatDuration, formatPercent } from "~/lib/insights";
import { useMemo } from "react";
import { BarList, ColumnChart, DataTable, escapeHtml, LineChart, withAlpha } from "./Charts";
import { type ChartOption, EChart, useChartTheme } from "./EChart";

/** Lines drawn at once; a breakdown's other values stay in the table and the ranked list. */
const LINES_SHOWN = 4;

export function TrendsChart({
  result,
  interval,
  title,
  compareLabel,
}: {
  result: TrendsResult;
  interval: Interval;
  title: string;
  /** What the period before is, in words, when the result compares with one. */
  compareLabel?: string;
}) {
  const broken = result.series.some((series) => series.breakdown !== null);
  const oneEvent = new Set(result.series.map((series) => series.event)).size === 1;
  return (
    <div className="grid gap-6">
      <LineChart
        title={title}
        buckets={result.buckets}
        interval={interval}
        compareLabel={compareLabel}
        series={result.series.slice(0, LINES_SHOWN).map((series) => ({
          // One event split by a property: its values say it all.
          label:
            series.breakdown !== null && oneEvent
              ? series.breakdown
              : eventLabel(series.event) + (series.breakdown === null ? "" : ` · ${series.breakdown}`),
          values: series.data,
          ...(series.previous ? { previous: series.previous.data } : {}),
        }))}
      />
      {broken && (
        <BarList
          rows={result.series.map((series) => ({
            key: series.label,
            label: series.breakdown ?? "(none)",
            value: series.total,
          }))}
        />
      )}
    </div>
  );
}

/** A funnel step in words: "Page view of /new", "Signed in". */
function stepLabel(step: FunnelQuery["steps"][number] | undefined, fallback: string): string {
  const path = step?.filters?.find((filter) => filter.key === "path" && filter.operator === "equals")?.value;
  const label = eventLabel(step?.event ?? fallback);
  return path === undefined ? label : `${label} of ${String(path)}`;
}

/**
 * A funnel as columns: everyone who got to each step, with those who dropped
 * off before it stacked faintly on top, so the losses read at a glance.
 */
export function FunnelChart({ result, query }: { result: FunnelResult; query: FunnelQuery }) {
  const theme = useChartTheme();
  const entered = result.steps[0]?.count ?? 0;
  const labels = result.steps.map((step, index) => `${index + 1}. ${stepLabel(query.steps[index], step.event)}`);
  const option = useMemo((): ChartOption | null => {
    if (!theme) return null;
    const color = theme.series[0];
    return {
      grid: { left: 4, right: 12, top: 28, bottom: 4, outerBoundsMode: "same", outerBoundsContain: "axisLabel" },
      tooltip: {
        trigger: "axis",
        axisPointer: { type: "shadow", shadowStyle: { color: withAlpha(theme.ink, 0.05) } },
        formatter: (params: unknown) => {
          const first = Array.isArray(params) ? params[0] : params;
          const index =
            typeof first === "object" && first !== null && "dataIndex" in first && typeof first.dataIndex === "number"
              ? first.dataIndex
              : 0;
          const step = result.steps[index];
          if (!step) return "";
          const lines = [
            `<div style="font-weight:700;margin-bottom:6px">${escapeHtml(labels[index] ?? "")}</div>`,
            `<div><strong>${formatCount(step.count)}</strong> people, ${formatPercent(step.conversion)} of those who started</div>`,
          ];
          if (index > 0) {
            const before = result.steps[index - 1]?.count ?? 0;
            lines.push(
              `<div>${formatPercent(step.stepConversion)} of step ${index}; ${formatCount(before - step.count)} dropped off</div>`,
            );
            if (step.medianMsFromPrevious !== null) {
              lines.push(
                `<div style="color:${theme.muted}">Median ${formatDuration(step.medianMsFromPrevious)} after</div>`,
              );
            }
          }
          return lines.join("");
        },
      },
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: theme.lineStrong } },
        axisTick: { show: false },
        axisLabel: { color: theme.ink, fontSize: 12, interval: 0, width: 140, overflow: "truncate" },
      },
      yAxis: {
        type: "value",
        max: entered,
        minInterval: 1,
        splitLine: { lineStyle: { color: theme.line } },
        axisLabel: { color: theme.muted, fontSize: 11, formatter: (value: number) => formatCount(value) },
      },
      series: [
        {
          type: "bar",
          name: "Got here",
          stack: "funnel",
          data: result.steps.map((step) => step.count),
          barMaxWidth: 72,
          itemStyle: { color, borderRadius: [0, 0, 4, 4] },
          label: {
            show: true,
            position: "top",
            color: theme.ink,
            fontWeight: "bold",
            formatter: (params: unknown) => {
              const index =
                typeof params === "object" &&
                params !== null &&
                "dataIndex" in params &&
                typeof params.dataIndex === "number"
                  ? params.dataIndex
                  : 0;
              return formatPercent(result.steps[index]?.conversion ?? 0);
            },
          },
        },
        {
          type: "bar",
          name: "Dropped off",
          stack: "funnel",
          data: result.steps.map((step) => entered - step.count),
          barMaxWidth: 72,
          itemStyle: { color: withAlpha(color, 0.16), borderRadius: [4, 4, 0, 0] },
          emphasis: { disabled: true },
        },
      ],
    };
  }, [theme, result, labels, entered]);

  if (entered === 0) return <p className="text-muted">Nobody started this funnel in the range.</p>;
  return (
    <figure className="grid gap-3">
      <EChart option={option} height={300} label="How many people got through each step" />
      <DataTable
        caption="People at each step"
        columns={["Step", "People", "Of everyone", "Of the step before", "Median time from the step before"]}
        rows={result.steps.map((step, index) => [
          labels[index] ?? step.event,
          step.count,
          formatPercent(step.conversion),
          index === 0 ? "—" : formatPercent(step.stepConversion),
          step.medianMsFromPrevious === null ? "—" : formatDuration(step.medianMsFromPrevious),
        ])}
      />
    </figure>
  );
}

export function RetentionGrid({ result }: { result: RetentionResult }) {
  const periods = result.average.length;
  const unit = result.interval === "day" ? "Day" : "Week";
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-sm">
        <caption className="sr-only">Retention by cohort</caption>
        <thead>
          <tr>
            <th scope="col" className="pr-3 text-left font-bold">
              Cohort
            </th>
            <th scope="col" className="pr-3 text-right font-bold">
              People
            </th>
            {Array.from({ length: periods }, (_, k) => (
              <th key={k} scope="col" className="px-1 text-center font-bold">
                {unit} {k}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row" className="pr-3 text-left font-bold">
              Average
            </th>
            <td />
            {result.average.map((share, k) => (
              <RetentionCell key={k} share={share} label={formatPercent(share)} />
            ))}
          </tr>
          {result.cohorts.map((cohort) => (
            <tr key={cohort.start}>
              <th scope="row" className="pr-3 text-left font-normal whitespace-nowrap">
                {formatBucket(cohort.start, "day")}
              </th>
              <td className="pr-3 text-right tabular-nums">{formatCount(cohort.size)}</td>
              {Array.from({ length: periods }, (_, k) => {
                const back = cohort.retained[k];
                if (back === undefined || cohort.size === 0) return <td key={k} />;
                return <RetentionCell key={k} share={back / cohort.size} label={formatPercent(back / cohort.size)} />;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One hue, deeper for more people back; capped so the label stays readable in both themes. */
function RetentionCell({ share, label }: { share: number; label: string }) {
  return (
    <td
      className="rounded-sm px-1 py-1 text-center tabular-nums"
      style={{ background: `color-mix(in oklab, var(--series-1) ${Math.round(share * 65)}%, var(--raised))` }}
    >
      {label}
    </td>
  );
}

/** Width each step of a journey takes, so long journeys scroll rather than squeeze. */
const STEP_WIDTH = 200;
const PATH_HEIGHT = 420;

/**
 * User journeys as a Sankey diagram: pages step by step, with links as wide
 * as their traffic. Hovering a page or a link lights up everything joined to
 * it, to follow one route through.
 */
export function PathsDiagram({ result }: { result: PathsResult }) {
  const theme = useChartTheme();
  const steps = result.nodes.length === 0 ? 0 : Math.max(...result.nodes.map((node) => node.step)) + 1;
  const option = useMemo((): ChartOption | null => {
    if (!theme || result.nodes.length === 0) return null;
    const byId = new Map(result.nodes.map((node) => [node.id, node]));
    const short = (path: string) => (path.length > 24 ? `${path.slice(0, 23)}…` : path);
    return {
      tooltip: {
        trigger: "item",
        formatter: (params: unknown) => {
          if (typeof params !== "object" || params === null || !("data" in params)) return "";
          const data = params.data;
          if (typeof data !== "object" || data === null) return "";
          if ("source" in data && "target" in data && "value" in data) {
            const from = byId.get(String(data.source));
            const to = byId.get(String(data.target));
            return `${escapeHtml(from?.path ?? "")} → ${escapeHtml(to?.path ?? "")}<br><strong>${formatCount(Number(data.value))}</strong> sessions`;
          }
          if ("name" in data) {
            const node = byId.get(String(data.name));
            if (!node) return "";
            return `<strong>${escapeHtml(node.path)}</strong><br>${formatCount(node.sessions)} sessions at step ${node.step + 1}, ${formatCount(node.dropoffs)} ended here`;
          }
          return "";
        },
      },
      series: [
        {
          type: "sankey",
          left: 8,
          right: 140,
          top: 8,
          bottom: 8,
          nodeAlign: "left",
          nodeWidth: 10,
          nodeGap: 10,
          layoutIterations: 32,
          draggable: false,
          emphasis: { focus: "adjacency" },
          data: result.nodes.map((node) => ({ name: node.id, value: node.sessions })),
          links: result.links.map((link) => ({ source: link.source, target: link.target, value: link.sessions })),
          itemStyle: { color: theme.series[0], borderWidth: 0, borderRadius: 2 },
          lineStyle: { color: "source", opacity: 0.28, curveness: 0.5 },
          label: {
            color: theme.ink,
            fontSize: 12,
            formatter: (params: unknown) =>
              typeof params === "object" && params !== null && "name" in params
                ? short(byId.get(String(params.name))?.path ?? "")
                : "",
          },
        },
      ],
    };
  }, [theme, result]);

  if (result.nodes.length === 0) return <p className="text-muted">No journeys in the range.</p>;
  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto">
        <div style={{ minWidth: Math.max(640, steps * STEP_WIDTH) }}>
          <EChart option={option} height={PATH_HEIGHT} label="Journeys between pages" />
        </div>
      </div>
      <DataTable
        caption="Most common journeys"
        columns={["Journey", "Sessions"]}
        rows={result.journeys.map((journey) => [journey.pages.join(" → "), journey.sessions])}
      />
    </div>
  );
}

export function StickinessChart({ result }: { result: StickinessResult }) {
  return (
    <ColumnChart
      title="People by how many days they came back"
      labels={result.persons.map((_, index) => `${index + 1}d`)}
      stacks={[{ label: "People", values: result.persons, series: 0 }]}
    />
  );
}

export function LifecycleChart({ result, interval }: { result: LifecycleResult; interval: "day" | "week" | "month" }) {
  return (
    <ColumnChart
      title="New, returning, resurrecting and dormant people"
      labels={result.buckets.map((bucket) => formatBucket(bucket, interval))}
      stacks={[
        { label: "New", values: result.new, series: 0 },
        { label: "Returning", values: result.returning, series: 1 },
        { label: "Resurrecting", values: result.resurrecting, series: 2 },
        { label: "Dormant", values: result.dormant, series: 3 },
      ]}
    />
  );
}
