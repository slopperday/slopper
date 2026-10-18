import type { FunctionReturnType } from "convex/server";
import type { ComponentApi } from "../component/_generated/component";
import {
  ANY_EVENT,
  bucketStart,
  DAY_MS,
  FunnelAggregator,
  type GroupReport,
  GroupReportAggregator,
  type GroupReportQuery,
  ErrorsAggregator,
  GroupsAggregator,
  HeatmapAggregator,
  SurveyAggregator,
  VitalsAggregator,
  type InsightAnswer,
  type InsightQuery,
  type InsightResult,
  LifecycleAggregator,
  PathsAggregator,
  RetentionAggregator,
  type RollupPlan,
  StickinessAggregator,
  type TimeRange,
  TrendsAggregator,
  WebAggregator,
  WEEK_MS,
} from "../shared/insights";
import { EVENTS } from "../shared/events";
import { RollupReader } from "./rollups";
import { PAGE_SIZE, SCAN_LIMIT, type ScanCtx, Scanner } from "./scanner";

type PersonsPage = FunctionReturnType<ComponentApi["scan"]["persons"]>;

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
 * page by page and aggregates as it goes. Trends without filters or
 * breakdown, web analytics and groups' page views read whole days from
 * daily rollups where there are any, and only the rest (today, the partial
 * days at either end, days not rolled up yet) raw. `now` caps how far ahead
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
  const rollups = new RollupReader(ctx, component);
  let result: InsightResult;
  switch (query.kind) {
    case "trends": {
      const trends = new TrendsAggregator(query);
      const range = TrendsAggregator.scanRange(query);
      const series = query.series.map((_, index) => index);
      const rolling = series.filter((index) => TrendsAggregator.rollupSeries(query, index));
      const plan: RollupPlan =
        rolling.length > 0
          ? await rollups.plan(range, (day) => TrendsAggregator.rollupDay(query, day))
          : { days: [], raw: [range] };
      const planned = new Set(plan.days);
      for (const [event, indexes] of byEvent(query.series.map((definition) => definition.event))) {
        const fromRollups = indexes.filter((index) => rolling.includes(index));
        const raw = indexes.filter((index) => !rolling.includes(index));
        if (fromRollups.length > 0) {
          await rollups.events(event, plan.days, (day) => {
            for (const index of fromRollups) trends.addDay(index, day);
          });
        }
        // A series that can't use rollups reads the whole range, and the others take its rows off their days.
        for (const segment of raw.length > 0 ? [range] : plan.raw) {
          await scan.events(event, segment, (row) => {
            for (const index of raw) trends.add(index, row);
            // Already counted from its day's rollup.
            if (planned.has(bucketStart(row.timestamp, "day"))) return;
            for (const index of fromRollups) trends.add(index, row);
          });
        }
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
      const range = GroupsAggregator.scanRange(query);
      const plan: RollupPlan = GroupsAggregator.rollupEvent(query)
        ? await rollups.plan(range, (day) => GroupsAggregator.rollupDay(query, day))
        : { days: [], raw: [range] };
      await rollups.groups(plan.days, (day) => groups.addDay(day));
      for (const segment of plan.raw) await scan.events(query.event, segment, (row) => groups.add(row));
      result = groups.result();
      break;
    }
    case "survey": {
      const survey = new SurveyAggregator(query);
      for (const event of [EVENTS.surveyShown, EVENTS.surveySent, EVENTS.surveyDismissed]) {
        await scan.events(event, query.range, (row) => survey.add(row));
      }
      result = survey.result();
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
      const plan = await rollups.plan(WebAggregator.scanRange(query), (day) => WebAggregator.rollupDay(query, day));
      await rollups.web(plan.days, (day) => web.addDay(day));
      for (const segment of plan.raw) {
        await scan.sessions(segment, (row) => web.addSession(row));
        await scan.events(EVENTS.pageview, segment, (row) => web.addPageview(row));
      }
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
