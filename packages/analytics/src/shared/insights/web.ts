import { EVENTS } from "../events";
import type { WebQuery } from "./queries";
import type { EventRow, SessionRow } from "./rows";
import { bucketsIn, bucketStart, type Interval, previousRange, type TimeRange } from "./time";

export interface WebTotals {
  /** Unique people. */
  visitors: number;
  sessions: number;
  pageviews: number;
  averageDurationMs: number;
  /** Share of sessions that bounced (0 to 1): one page, nothing clicked, under ten seconds. */
  bounceRate: number;
}

export interface WebRow {
  value: string;
  visitors: number;
  /** Sessions for session breakdowns, page views for pages. */
  count: number;
}

export interface WebBreakdowns {
  pages: WebRow[];
  entryPages: WebRow[];
  exitPages: WebRow[];
  channels: WebRow[];
  referrers: WebRow[];
  utmSources: WebRow[];
  utmCampaigns: WebRow[];
  browsers: WebRow[];
  operatingSystems: WebRow[];
  devices: WebRow[];
  countries: WebRow[];
}

export interface WebResult {
  kind: "web";
  totals: WebTotals;
  /** The same numbers for the period of equal length before, to compare against. */
  previous: WebTotals;
  series: { buckets: number[]; visitors: number[]; sessions: number[]; pageviews: number[] };
  /** The period before, lined up with `series`' buckets. */
  previousSeries: { visitors: number[]; sessions: number[]; pageviews: number[] };
  breakdowns: WebBreakdowns;
}

/** Rows per breakdown. */
export const WEB_ROW_LIMIT = 10;
const BOUNCE_MS = 10_000;

export function bounced(session: SessionRow): boolean {
  return session.pageviews <= 1 && session.interactions === 0 && session.endedAt - session.startedAt < BOUNCE_MS;
}

class Tally {
  private readonly rows = new Map<string, { visitors: Set<string>; count: number }>();

  add(value: string | null, personId: string): void {
    if (value === null || value === "") return;
    const row = this.rows.get(value) ?? { visitors: new Set<string>(), count: 0 };
    row.visitors.add(personId);
    row.count += 1;
    this.rows.set(value, row);
  }

  top(): WebRow[] {
    return [...this.rows.entries()]
      .map(([value, row]) => ({ value, visitors: row.visitors.size, count: row.count }))
      .sort((a, b) => b.count - a.count || b.visitors - a.visitors || a.value.localeCompare(b.value))
      .slice(0, WEB_ROW_LIMIT);
  }
}

class Totals {
  readonly visitors = new Set<string>();
  sessions = 0;
  pageviews = 0;
  duration = 0;
  bounces = 0;

  addSession(session: SessionRow): void {
    this.visitors.add(session.personId);
    this.sessions += 1;
    this.duration += Math.max(0, session.endedAt - session.startedAt);
    if (bounced(session)) this.bounces += 1;
  }

  result(): WebTotals {
    return {
      visitors: this.visitors.size,
      sessions: this.sessions,
      pageviews: this.pageviews,
      averageDurationMs: this.sessions === 0 ? 0 : Math.round(this.duration / this.sessions),
      bounceRate: this.sessions === 0 ? 0 : this.bounces / this.sessions,
    };
  }
}

/**
 * Web analytics: sessions that started in the range (and the period before,
 * for comparison) with `addSession`, and page views with `addPageview`.
 * `scanRange` is what to feed both from.
 */
export class WebAggregator {
  private readonly current = new Totals();
  private readonly before = new Totals();
  private readonly previousRange: TimeRange;
  private readonly buckets: number[];
  private readonly index = new Map<number, number>();
  private readonly seriesVisitors: Set<string>[];
  private readonly seriesSessions: number[];
  private readonly seriesPageviews: number[];
  private readonly beforeVisitors: Set<string>[];
  private readonly beforeSessions: number[];
  private readonly beforePageviews: number[];
  private readonly tallies = {
    pages: new Tally(),
    entryPages: new Tally(),
    exitPages: new Tally(),
    channels: new Tally(),
    referrers: new Tally(),
    utmSources: new Tally(),
    utmCampaigns: new Tally(),
    browsers: new Tally(),
    operatingSystems: new Tally(),
    devices: new Tally(),
    countries: new Tally(),
  };

  constructor(private readonly query: WebQuery) {
    const { range } = query;
    this.previousRange = previousRange(range);
    this.buckets = bucketsIn(range, query.interval);
    this.buckets.forEach((start, position) => this.index.set(start, position));
    this.seriesVisitors = this.buckets.map(() => new Set());
    this.seriesSessions = this.buckets.map(() => 0);
    this.seriesPageviews = this.buckets.map(() => 0);
    this.beforeVisitors = this.buckets.map(() => new Set());
    this.beforeSessions = this.buckets.map(() => 0);
    this.beforePageviews = this.buckets.map(() => 0);
  }

  /** The bucket of a moment in the period before: where it falls one period later. */
  private bucketBefore(timestamp: number): number | undefined {
    return this.bucket(timestamp + (this.query.range.to - this.query.range.from), this.query.interval);
  }

  static scanRange(query: WebQuery): TimeRange {
    return { from: previousRange(query.range).from, to: query.range.to };
  }

  private bucket(timestamp: number, interval: Interval): number | undefined {
    return this.index.get(bucketStart(timestamp, interval));
  }

  addSession(session: SessionRow): void {
    const at = session.startedAt;
    if (at >= this.previousRange.from && at < this.previousRange.to) {
      this.before.addSession(session);
      const bucket = this.bucketBefore(at);
      if (bucket !== undefined) {
        this.beforeVisitors[bucket]?.add(session.personId);
        this.beforeSessions[bucket] = (this.beforeSessions[bucket] ?? 0) + 1;
      }
      return;
    }
    if (at < this.query.range.from || at >= this.query.range.to) return;
    this.current.addSession(session);
    const bucket = this.bucket(at, this.query.interval);
    if (bucket !== undefined) {
      this.seriesVisitors[bucket]?.add(session.personId);
      this.seriesSessions[bucket] = (this.seriesSessions[bucket] ?? 0) + 1;
    }
    const { tallies } = this;
    tallies.entryPages.add(session.entryPath, session.personId);
    tallies.exitPages.add(session.exitPath, session.personId);
    tallies.channels.add(session.channel, session.personId);
    tallies.referrers.add(session.referrerDomain, session.personId);
    tallies.utmSources.add(session.utmSource, session.personId);
    tallies.utmCampaigns.add(session.utmCampaign, session.personId);
    tallies.browsers.add(session.browser, session.personId);
    tallies.operatingSystems.add(session.os, session.personId);
    tallies.devices.add(session.deviceType, session.personId);
    tallies.countries.add(session.country, session.personId);
  }

  addPageview(event: EventRow): void {
    if (event.name !== EVENTS.pageview) return;
    if (event.timestamp >= this.previousRange.from && event.timestamp < this.previousRange.to) {
      this.before.pageviews += 1;
      const bucket = this.bucketBefore(event.timestamp);
      if (bucket !== undefined) this.beforePageviews[bucket] = (this.beforePageviews[bucket] ?? 0) + 1;
      return;
    }
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    this.current.pageviews += 1;
    const bucket = this.bucket(event.timestamp, this.query.interval);
    if (bucket !== undefined) this.seriesPageviews[bucket] = (this.seriesPageviews[bucket] ?? 0) + 1;
    this.tallies.pages.add(event.path, event.personId);
  }

  result(): WebResult {
    const { tallies } = this;
    const breakdowns: WebBreakdowns = {
      pages: tallies.pages.top(),
      entryPages: tallies.entryPages.top(),
      exitPages: tallies.exitPages.top(),
      channels: tallies.channels.top(),
      referrers: tallies.referrers.top(),
      utmSources: tallies.utmSources.top(),
      utmCampaigns: tallies.utmCampaigns.top(),
      browsers: tallies.browsers.top(),
      operatingSystems: tallies.operatingSystems.top(),
      devices: tallies.devices.top(),
      countries: tallies.countries.top(),
    };
    return {
      kind: "web",
      totals: this.current.result(),
      previous: this.before.result(),
      series: {
        buckets: this.buckets,
        visitors: this.seriesVisitors.map((visitors) => visitors.size),
        sessions: this.seriesSessions,
        pageviews: this.seriesPageviews,
      },
      previousSeries: {
        visitors: this.beforeVisitors.map((visitors) => visitors.size),
        sessions: this.beforeSessions,
        pageviews: this.beforePageviews,
      },
      breakdowns,
    };
  }
}
