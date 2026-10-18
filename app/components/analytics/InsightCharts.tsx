import type {
  FunnelResult,
  Interval,
  LifecycleResult,
  PathsResult,
  RetentionResult,
  StickinessResult,
  TrendsResult,
} from "@slopperday/analytics/shared/insights";
import { formatBucket, formatCount, formatDuration, formatPercent } from "~/lib/insights";
import { BarList, ColumnChart, DataTable, LineChart, seriesColor } from "./Charts";

/** Lines drawn at once; a breakdown's other values stay in the table and the ranked list. */
const LINES_SHOWN = 4;

export function TrendsChart({ result, interval, title }: { result: TrendsResult; interval: Interval; title: string }) {
  const broken = result.series.some((series) => series.breakdown !== null);
  return (
    <div className="grid gap-6">
      <LineChart
        title={title}
        buckets={result.buckets}
        interval={interval}
        series={result.series.slice(0, LINES_SHOWN).map((series) => ({ label: series.label, values: series.data }))}
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

export function FunnelChart({ result }: { result: FunnelResult }) {
  const entered = result.steps[0]?.count ?? 0;
  if (entered === 0) return <p className="text-muted">Nobody started this funnel in the range.</p>;
  return (
    <ol className="grid gap-3">
      {result.steps.map((step, index) => (
        <li key={`${index}-${step.event}`} className="grid gap-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span>
              <span className="font-bold">{index + 1}.</span> {step.event}
            </span>
            <span className="tabular-nums">
              {formatCount(step.count)} · {formatPercent(step.conversion)}
              {index > 0 && step.medianMsFromPrevious !== null && (
                <span className="ml-2 text-muted">median {formatDuration(step.medianMsFromPrevious)} after</span>
              )}
            </span>
          </div>
          <div className="h-6 rounded-sm bg-sunk">
            <div
              className="h-full rounded-sm"
              style={{
                width: `${Math.max(step.conversion * 100, step.count > 0 ? 1 : 0)}%`,
                background: seriesColor(0),
              }}
              title={`${formatCount(step.count)} people, ${formatPercent(step.stepConversion)} of the step before`}
            />
          </div>
          {index > 0 && (
            <p className="text-xs text-muted">
              {formatPercent(step.stepConversion)} of step {index};{" "}
              {formatCount((result.steps[index - 1]?.count ?? 0) - step.count)} dropped off
            </p>
          )}
        </li>
      ))}
    </ol>
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

const COLUMN_WIDTH = 190;
const NODE_WIDTH = 10;
const PATH_HEIGHT = 360;

/** User journeys as columns of pages, step by step, with links as wide as their traffic. */
export function PathsDiagram({ result }: { result: PathsResult }) {
  if (result.nodes.length === 0) return <p className="text-muted">No journeys in the range.</p>;
  const steps = Math.max(...result.nodes.map((node) => node.step)) + 1;
  const width = steps * COLUMN_WIDTH;
  const columns = Array.from({ length: steps }, (_, step) => result.nodes.filter((node) => node.step === step));
  const scale = Math.max(...columns.map((nodes) => nodes.reduce((sum, node) => sum + node.sessions, 0)));
  const gap = 8;
  const positions = new Map<string, { x: number; y: number; height: number; next: number; previous: number }>();
  columns.forEach((nodes, step) => {
    const room = PATH_HEIGHT - gap * Math.max(0, nodes.length - 1);
    let y = 0;
    for (const node of nodes) {
      const height = Math.max(3, (node.sessions / scale) * room);
      positions.set(node.id, { x: step * COLUMN_WIDTH, y, height, next: y, previous: y });
      y += height + gap;
    }
  });
  const unit = (PATH_HEIGHT - gap * 4) / scale;
  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} ${PATH_HEIGHT + 4}`}
        style={{ minWidth: Math.min(width, 900) }}
        className="block w-full"
        role="img"
        aria-label="Journeys between pages"
      >
        {result.links.map((link) => {
          const source = positions.get(link.source);
          const target = positions.get(link.target);
          if (!source || !target) return null;
          const thickness = Math.max(1.5, link.sessions * unit);
          const y1 = source.next + thickness / 2;
          const y2 = target.previous + thickness / 2;
          source.next += thickness;
          target.previous += thickness;
          const x1 = source.x + NODE_WIDTH;
          const x2 = target.x;
          const middle = (x1 + x2) / 2;
          return (
            <path
              key={`${link.source}-${link.target}`}
              d={`M${x1},${y1} C${middle},${y1} ${middle},${y2} ${x2},${y2}`}
              fill="none"
              stroke={seriesColor(0)}
              strokeOpacity={0.35}
              strokeWidth={thickness}
            >
              <title>{`${link.source.split(":").slice(1).join(":")} → ${link.target.split(":").slice(1).join(":")}: ${formatCount(link.sessions)} sessions`}</title>
            </path>
          );
        })}
        {result.nodes.map((node) => {
          const position = positions.get(node.id);
          if (!position) return null;
          return (
            <g key={node.id}>
              <rect
                x={position.x}
                y={position.y}
                width={NODE_WIDTH}
                height={position.height}
                rx={2}
                fill={seriesColor(0)}
              >
                <title>{`${node.path}: ${formatCount(node.sessions)} sessions, ${formatCount(node.dropoffs)} ended here`}</title>
              </rect>
              <text
                x={position.x + NODE_WIDTH + 6}
                y={position.y + Math.min(position.height / 2, 10)}
                dy="0.32em"
                className="fill-ink text-[12px]"
              >
                {node.path.length > 22 ? `${node.path.slice(0, 21)}…` : node.path}
              </text>
            </g>
          );
        })}
      </svg>
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
      stacks={[{ label: "People", values: result.persons, color: seriesColor(0) }]}
    />
  );
}

export function LifecycleChart({ result, interval }: { result: LifecycleResult; interval: "day" | "week" | "month" }) {
  return (
    <ColumnChart
      title="New, returning, resurrecting and dormant people"
      labels={result.buckets.map((bucket) => formatBucket(bucket, interval))}
      stacks={[
        { label: "New", values: result.new, color: seriesColor(0) },
        { label: "Returning", values: result.returning, color: seriesColor(1) },
        { label: "Resurrecting", values: result.resurrecting, color: seriesColor(2) },
        { label: "Dormant", values: result.dormant, color: seriesColor(3) },
      ]}
    />
  );
}
