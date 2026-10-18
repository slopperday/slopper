import type { FunctionReturnType, GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component";
import {
  ANY_EVENT,
  DAY_MS,
  type EventRow,
  FunnelAggregator,
  type GroupReport,
  GroupReportAggregator,
  type GroupReportQuery,
  ErrorsAggregator,
  GroupsAggregator,
  HeatmapAggregator,
  VitalsAggregator,
  type InsightAnswer,
  type InsightQuery,
  type InsightResult,
  LifecycleAggregator,
  PathsAggregator,
  RetentionAggregator,
  type SessionRow,
  StickinessAggregator,
  type TimeRange,
  TrendsAggregator,
  WebAggregator,
  WEEK_MS,
} from "../shared/insights";
import { EVENTS } from "../shared/events";
import type { Channel } from "../shared/source";

type ScanCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type EventsPage = FunctionReturnType<ComponentApi["scan"]["events"]>;
type SessionsPage = FunctionReturnType<ComponentApi["scan"]["sessions"]>;
type PersonsPage = FunctionReturnType<ComponentApi["scan"]["persons"]>;

/** Rows per page: one query each, well inside Convex's per-query read limits. */
const PAGE_SIZE = 2_000;
/**
 * Most rows one insight reads. Past it the answer says it's `truncated`:
 * the numbers cover the start of the range only.
 */
export const SCAN_LIMIT = 200_000;
/** The longest range an insight covers. */
export const MAX_RANGE_DAYS = 400;

export interface Overview {
  /** Everyone ever seen (and not yet past retention). */
  people: number;
  /** People linked to an account. */
  identified: number;
  activeToday: number;
  activeThisWeek: number;
  activeThisMonth: number;
  newThisWeek: number;
  truncated: boolean;
}

/** Reads events and sessions page by page for the engines here, counting what it read. */
export class Scanner {
  scanned = 0;
  truncated = false;

  constructor(
    private readonly ctx: ScanCtx,
    private readonly component: ComponentApi,
  ) {}

  private full(): boolean {
    if (this.scanned >= SCAN_LIMIT) this.truncated = true;
    return this.truncated;
  }

  /**
   * Every occurrence of `name` (every event for `ANY_EVENT`) in the range,
   * oldest first; only one group's with `group`.
   */
  async events(name: string, range: TimeRange, each: (row: EventRow) => void, group?: string): Promise<void> {
    let cursor: string | null = null;
    while (!this.full()) {
      const result: EventsPage = await this.ctx.runQuery(this.component.scan.events, {
        name: name === ANY_EVENT ? null : name,
        ...(group === undefined ? {} : { group }),
        from: range.from,
        to: range.to,
        cursor,
        numItems: PAGE_SIZE,
      });
      for (const row of result.page) each(row);
      this.scanned += result.page.length;
      if (result.isDone) return;
      cursor = result.continueCursor;
    }
  }

  /** Sessions that started in the range, oldest first. */
  async sessions(range: TimeRange, each: (row: SessionRow) => void): Promise<void> {
    let cursor: string | null = null;
    while (!this.full()) {
      const result: SessionsPage = await this.ctx.runQuery(this.component.scan.sessions, {
        from: range.from,
        to: range.to,
        cursor,
        numItems: PAGE_SIZE,
      });
      for (const session of result.page) {
        each({
          sessionId: session.sessionId,
          personId: session.personId,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          pageviews: session.pageviews,
          interactions: session.interactions,
          entryPath: session.entryPath,
          exitPath: session.exitPath,
          channel: session.source.channel,
          referrerDomain: session.source.referrerDomain,
          utmSource: session.source.utmSource,
          utmCampaign: session.source.utmCampaign,
          browser: session.device.browser,
          os: session.device.os,
          deviceType: session.device.deviceType,
          country: session.country,
        });
      }
      this.scanned += result.page.length;
      if (result.isDone) return;
      cursor = result.continueCursor;
    }
  }

  async sources(
    sessionIds: readonly string[],
    each: (sessionId: string, source: { referrerDomain: string | null; channel: Channel }) => void,
  ): Promise<void> {
    for (let start = 0; start < sessionIds.length; start += 500) {
      const found = await this.ctx.runQuery(this.component.scan.sessionSources, {
        sessionIds: sessionIds.slice(start, start + 500),
      });
      for (const { sessionId, source } of found) each(sessionId, source);
    }
  }

  async firstSeen(personIds: readonly string[]): Promise<Map<string, number>> {
    const seen = new Map<string, number>();
    for (let start = 0; start < personIds.length; start += 500) {
      const found = await this.ctx.runQuery(this.component.scan.firstSeen, {
        personIds: personIds.slice(start, start + 500),
      });
      for (const { personId, createdAt } of found) seen.set(personId, createdAt);
    }
    return seen;
  }
}

/** Refuses ranges that are backwards or too long to answer. */
export function checkRange(range: TimeRange): void {
  if (!(range.to > range.from)) throw new Error("A range ends after it starts.");
  if (range.to - range.from > MAX_RANGE_DAYS * DAY_MS)
    throw new Error(`A range covers ${MAX_RANGE_DAYS} days at most.`);
}

/** Groups indexes by the event they read, so each event is scanned once. */
function byEvent(events: readonly string[]): Map<string, number[]> {
  const groups = new Map<string, number[]>();
  events.forEach((event, index) => groups.set(event, [...(groups.get(event) ?? []), index]));
  return groups;
}

/**
 * Answers an insight from an action: reads the events and sessions it needs
 * page by page and aggregates as it goes. `now` caps how far ahead
 * follow-up periods (funnel windows, retention) are read.
 */
export async function runInsight(
  ctx: ScanCtx,
  component: ComponentApi,
  query: InsightQuery,
  now: number,
): Promise<InsightAnswer> {
  checkRange(query.range);
  const scan = new Scanner(ctx, component);
  let result: InsightResult;
  switch (query.kind) {
    case "trends": {
      const trends = new TrendsAggregator(query);
      const range = TrendsAggregator.scanRange(query);
      for (const [event, indexes] of byEvent(query.series.map((series) => series.event))) {
        await scan.events(event, range, (row) => {
          for (const index of indexes) trends.add(index, row);
        });
      }
      result = trends.result();
      break;
    }
    case "funnel": {
      const funnel = new FunnelAggregator(query);
      const followUp = { from: query.range.from, to: Math.min(now, query.range.to + query.windowDays * DAY_MS) };
      for (const [event, indexes] of byEvent(query.steps.map((step) => step.event))) {
        const range = indexes.every((index) => index === 0) ? query.range : followUp;
        await scan.events(event, range, (row) => {
          for (const index of indexes) funnel.add(index, row);
        });
      }
      result = funnel.result();
      break;
    }
    case "retention": {
      const retention = new RetentionAggregator(query, now);
      const period = query.interval === "day" ? DAY_MS : WEEK_MS;
      const followUp = { from: query.range.from, to: Math.min(now, query.range.to + query.periods * period) };
      if (query.startEvent === query.returnEvent) {
        await scan.events(query.startEvent, followUp, (row) => {
          retention.addStart(row);
          retention.addReturn(row);
        });
      } else {
        await scan.events(query.startEvent, query.range, (row) => retention.addStart(row));
        await scan.events(query.returnEvent, followUp, (row) => retention.addReturn(row));
      }
      result = retention.result();
      break;
    }
    case "paths": {
      const paths = new PathsAggregator(query);
      await scan.events(EVENTS.pageview, query.range, (row) => paths.add(row));
      result = paths.result();
      break;
    }
    case "stickiness": {
      const stickiness = new StickinessAggregator(query);
      await scan.events(query.event, query.range, (row) => stickiness.add(row));
      result = stickiness.result();
      break;
    }
    case "lifecycle": {
      const lifecycle = new LifecycleAggregator(query);
      await scan.events(query.event, LifecycleAggregator.scanRange(query), (row) => lifecycle.add(row));
      result = lifecycle.result(await scan.firstSeen(lifecycle.people));
      break;
    }
    case "groups": {
      const groups = new GroupsAggregator(query);
      await scan.events(query.event, GroupsAggregator.scanRange(query), (row) => groups.add(row));
      result = groups.result();
      break;
    }
    case "vitals": {
      const vitals = new VitalsAggregator(query);
      await scan.events(EVENTS.webVitals, query.range, (row) => vitals.add(row));
      result = vitals.result();
      break;
    }
    case "errors": {
      const errors = new ErrorsAggregator(query);
      await scan.events(EVENTS.exception, query.range, (row) => errors.add(row));
      result = errors.result();
      break;
    }
    case "heatmap": {
      const heatmap = new HeatmapAggregator(query);
      for (const event of [EVENTS.pageview, EVENTS.pageleave, EVENTS.heatmap, EVENTS.autocapture]) {
        await scan.events(event, query.range, (row) => heatmap.add(row));
      }
      result = heatmap.result();
      break;
    }
    case "web": {
      const web = new WebAggregator(query);
      const range = WebAggregator.scanRange(query);
      await scan.sessions(range, (row) => web.addSession(row));
      await scan.events(EVENTS.pageview, range, (row) => web.addPageview(row));
      result = web.result();
      break;
    }
  }
  return { result, scanned: scan.scanned, truncated: scan.truncated };
}

/** Sessions looked up for a report's sources; a busier group's are sampled from its first ones. */
const REPORT_SOURCE_SESSIONS = 5_000;

/**
 * Everything about one group (`type:id`), like one project's views, the
 * people behind them, where they came from and what they clicked.
 */
export async function groupReport(
  ctx: ScanCtx,
  component: ComponentApi,
  query: GroupReportQuery,
): Promise<{ report: GroupReport; truncated: boolean }> {
  checkRange(query.range);
  const scan = new Scanner(ctx, component);
  const report = new GroupReportAggregator(query);
  await scan.events(ANY_EVENT, GroupReportAggregator.scanRange(query), (row) => report.add(row), query.group);
  await scan.sources(report.sessionIds.slice(0, REPORT_SOURCE_SESSIONS), (sessionId, source) =>
    report.addSource(sessionId, source),
  );
  return { report: report.result(), truncated: scan.truncated };
}

/** How many people there are, and how many were active lately. */
export async function overview(ctx: ScanCtx, component: ComponentApi, now: number): Promise<Overview> {
  const counts: Overview = {
    people: 0,
    identified: 0,
    activeToday: 0,
    activeThisWeek: 0,
    activeThisMonth: 0,
    newThisWeek: 0,
    truncated: false,
  };
  let cursor: string | null = null;
  for (let read = 0; ;) {
    if (read >= SCAN_LIMIT) {
      counts.truncated = true;
      return counts;
    }
    const result: PersonsPage = await ctx.runQuery(component.scan.persons, {
      cursor,
      numItems: PAGE_SIZE,
    });
    for (const person of result.page) {
      counts.people += 1;
      if (person.identified) counts.identified += 1;
      if (person.lastSeenAt >= now - DAY_MS) counts.activeToday += 1;
      if (person.lastSeenAt >= now - 7 * DAY_MS) counts.activeThisWeek += 1;
      if (person.lastSeenAt >= now - 30 * DAY_MS) counts.activeThisMonth += 1;
      if (person.createdAt >= now - 7 * DAY_MS) counts.newThisWeek += 1;
    }
    read += result.page.length;
    if (result.isDone) return counts;
    cursor = result.continueCursor;
  }
}
