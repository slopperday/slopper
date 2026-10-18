import type { TrendsMath, TrendsQuery } from "./queries";
import type { EventDay } from "./rollups";
import { breakdownValue, type EventRow, matchesAll } from "./rows";
import { alignedByDays, bucketsIn, bucketStart, previousRange, type TimeRange, wholeDayIn } from "./time";

export interface TrendsSeriesResult {
  label: string;
  event: string;
  math: TrendsMath;
  /** The breakdown value this line is for; null without a breakdown, or for events without the property. */
  breakdown: string | null;
  /** One number per bucket. */
  data: number[];
  /** For the whole range: a sum of events, or unique people or sessions (not a sum of the buckets). */
  total: number;
  /** With `compare`: the period just before, lined up with this one's buckets, and its total. */
  previous?: { data: number[]; total: number };
}

export interface TrendsResult {
  kind: "trends";
  buckets: number[];
  series: TrendsSeriesResult[];
}

/** Breakdown values shown on their own; the rest are folded into "Other". */
export const BREAKDOWN_LIMIT = 10;
export const OTHER = "Other";

/** Counts for one line: events per bucket, or the ids seen in each bucket. */
class Line {
  readonly counts: number[];
  readonly ids: Set<string>[];
  readonly all = new Set<string>();
  events = 0;

  constructor(buckets: number) {
    this.counts = Array.from({ length: buckets }, () => 0);
    this.ids = Array.from({ length: buckets }, () => new Set<string>());
  }

  add(bucket: number, id: string | null): void {
    this.counts[bucket] = (this.counts[bucket] ?? 0) + 1;
    this.events += 1;
    if (id === null) return;
    this.ids[bucket]?.add(id);
    this.all.add(id);
  }

  /** A day's rollup: its events, and everyone who did it. */
  addDay(bucket: number, count: number, ids: readonly string[]): void {
    this.counts[bucket] = (this.counts[bucket] ?? 0) + count;
    this.events += count;
    for (const id of ids) {
      this.ids[bucket]?.add(id);
      this.all.add(id);
    }
  }

  merge(other: Line): void {
    for (let index = 0; index < this.counts.length; index += 1) {
      this.counts[index] = (this.counts[index] ?? 0) + (other.counts[index] ?? 0);
      for (const id of other.ids[index] ?? []) this.ids[index]?.add(id);
    }
    for (const id of other.all) this.all.add(id);
    this.events += other.events;
  }

  data(math: TrendsMath): number[] {
    return math === "total" ? this.counts : this.ids.map((ids) => ids.size);
  }

  total(math: TrendsMath): number {
    return math === "total" ? this.events : this.all.size;
  }
}

/**
 * Trends, fed one series' events at a time (`add(seriesIndex, event)`), in
 * any order. Events outside the range or not matching the series' filters
 * are ignored. A series without filters counting events or people, in a
 * query without a breakdown (`rollupSeries`), can take whole days from
 * rollups instead (`addDay`, for the days `rollupDay` accepts).
 */
export class TrendsAggregator {
  private readonly buckets: number[];
  private readonly index = new Map<number, number>();
  private readonly lines: Map<string | null, Line>[];
  private readonly previousLines: Map<string | null, Line>[];
  private readonly before: TimeRange;

  constructor(private readonly query: TrendsQuery) {
    this.buckets = bucketsIn(query.range, query.interval);
    this.buckets.forEach((start, position) => this.index.set(start, position));
    this.lines = query.series.map(() => new Map());
    this.previousLines = query.series.map(() => new Map());
    this.before = previousRange(query.range);
  }

  /** What to feed it from: the range, and the period before it too when comparing. */
  static scanRange(query: TrendsQuery): TimeRange {
    return query.compare ? { from: previousRange(query.range).from, to: query.range.to } : query.range;
  }

  /** Whether a series can read whole days from rollups, which keep counts and people per event name. */
  static rollupSeries(query: TrendsQuery, seriesIndex: number): boolean {
    const series = query.series[seriesIndex];
    return (
      series !== undefined &&
      query.breakdown === undefined &&
      (series.filters ?? []).length === 0 &&
      series.math !== "sessions"
    );
  }

  /**
   * Whether a day can come from its rollup: it lies wholly in the range,
   * or, when comparing, wholly in the period before and that period is a
   * whole number of days long (so the day lines up with one bucket).
   */
  static rollupDay(query: TrendsQuery, day: number): boolean {
    if (wholeDayIn(day, query.range)) return true;
    return query.compare === true && alignedByDays(query.range) && wholeDayIn(day, previousRange(query.range));
  }

  /** One whole day of a series' event, from its rollup, in place of that day's events. */
  addDay(seriesIndex: number, day: EventDay): void {
    if (!TrendsAggregator.rollupSeries(this.query, seriesIndex)) {
      throw new Error("Only series without filters, breakdown or sessions read rollups.");
    }
    const before = !wholeDayIn(day.day, this.query.range);
    if (!TrendsAggregator.rollupDay(this.query, day.day)) {
      throw new Error("That day isn't wholly in the range or the period before.");
    }
    const lines = (before ? this.previousLines : this.lines)[seriesIndex];
    if (!lines) return;
    const at = before ? day.day + (this.query.range.to - this.query.range.from) : day.day;
    const bucket = this.index.get(bucketStart(at, this.query.interval));
    if (bucket === undefined) return;
    let line = lines.get(null);
    if (!line) {
      line = new Line(this.buckets.length);
      lines.set(null, line);
    }
    line.addDay(bucket, day.count, day.people);
  }

  add(seriesIndex: number, event: EventRow): void {
    const series = this.query.series[seriesIndex];
    if (!series || !matchesAll(event, series.filters)) return;
    const inRange = event.timestamp >= this.query.range.from && event.timestamp < this.query.range.to;
    const before =
      this.query.compare === true && event.timestamp >= this.before.from && event.timestamp < this.before.to;
    if (!inRange && !before) return;
    const lines = (before ? this.previousLines : this.lines)[seriesIndex];
    if (!lines) return;
    // The period before lines up with this one: its moment one period later picks the bucket.
    const at = before ? event.timestamp + (this.query.range.to - this.query.range.from) : event.timestamp;
    const bucket = this.index.get(bucketStart(at, this.query.interval));
    if (bucket === undefined) return;
    const key = this.query.breakdown ? breakdownValue(event, this.query.breakdown) : null;
    let line = lines.get(key);
    if (!line) {
      line = new Line(this.buckets.length);
      lines.set(key, line);
    }
    line.add(bucket, series.math === "persons" ? event.personId : series.math === "sessions" ? event.sessionId : null);
  }

  result(): TrendsResult {
    const series: TrendsSeriesResult[] = [];
    this.query.series.forEach((definition, seriesIndex) => {
      const lines = this.lines[seriesIndex] ?? new Map<string | null, Line>();
      const previousLines = this.previousLines[seriesIndex] ?? new Map<string | null, Line>();
      const previousOf = (lineKeys: (string | null)[]) => {
        if (!this.query.compare) return {};
        const merged = new Line(this.buckets.length);
        for (const key of lineKeys) {
          const line = previousLines.get(key);
          if (line) merged.merge(line);
        }
        return { previous: { data: merged.data(definition.math), total: merged.total(definition.math) } };
      };
      const label = (value: string | null) =>
        this.query.breakdown ? `${definition.event} · ${value ?? "(none)"}` : definition.event;
      const ranked = [...lines.entries()].sort(([, a], [, b]) => b.total(definition.math) - a.total(definition.math));
      const shown = this.query.breakdown ? ranked.slice(0, BREAKDOWN_LIMIT) : ranked;
      const rest = this.query.breakdown ? ranked.slice(BREAKDOWN_LIMIT) : [];
      if (shown.length === 0) shown.push([null, new Line(this.buckets.length)]);
      for (const [value, line] of shown) {
        series.push({
          label: label(value),
          event: definition.event,
          math: definition.math,
          breakdown: value,
          data: line.data(definition.math),
          total: line.total(definition.math),
          ...previousOf([value]),
        });
      }
      if (rest.length > 0) {
        const other = new Line(this.buckets.length);
        for (const [, line] of rest) other.merge(line);
        series.push({
          label: label(OTHER),
          event: definition.event,
          math: definition.math,
          breakdown: OTHER,
          data: other.data(definition.math),
          total: other.total(definition.math),
          ...previousOf(rest.map(([value]) => value)),
        });
      }
    });
    return { kind: "trends", buckets: this.buckets, series };
  }
}
