import { EVENTS } from "../events";
import { stringProperty } from "../properties";
import type { Channel } from "../source";
import type { GroupsQuery } from "./queries";
import type { EventRow } from "./rows";
import { bucketsIn, bucketStart, type Interval, previousRange, type TimeRange } from "./time";
import type { WebRow } from "./web";

/**
 * Group analytics: events about a thing (a project, a team), as the app
 * tagged them (`type:id`). The leaderboard compares every group with the
 * period before; the report is everything about one group.
 */

export interface GroupRow {
  group: string;
  count: number;
  /** Unique people. */
  people: number;
  previousCount: number;
  previousPeople: number;
}

export interface GroupsResult {
  kind: "groups";
  /** The busiest groups in the range, most events first. */
  rows: GroupRow[];
  /** Groups with any events in the range. */
  active: number;
  /** More events than the period before. */
  rising: number;
  /** Fewer events than the period before (including none). */
  falling: number;
  /** Events in the range, none in the period before. */
  new: number;
}

export const GROUP_ROW_LIMIT = 50;

interface Counts {
  count: number;
  people: Set<string>;
}

/** Feed the event from the period before the range on (`scanRange`). */
export class GroupsAggregator {
  private readonly current = new Map<string, Counts>();
  private readonly before = new Map<string, Counts>();
  private readonly previous: TimeRange;

  constructor(private readonly query: GroupsQuery) {
    this.previous = previousRange(query.range);
  }

  static scanRange(query: GroupsQuery): TimeRange {
    return { from: previousRange(query.range).from, to: query.range.to };
  }

  add(event: EventRow): void {
    const group = event.group;
    if (!group || (this.query.prefix !== undefined && !group.startsWith(this.query.prefix))) return;
    const inRange = event.timestamp >= this.query.range.from && event.timestamp < this.query.range.to;
    const inPrevious = event.timestamp >= this.previous.from && event.timestamp < this.previous.to;
    const target = inRange ? this.current : inPrevious ? this.before : null;
    if (!target) return;
    const counts = target.get(group) ?? { count: 0, people: new Set<string>() };
    counts.count += 1;
    counts.people.add(event.personId);
    target.set(group, counts);
  }

  result(): GroupsResult {
    const rows: GroupRow[] = [];
    let rising = 0;
    let falling = 0;
    let fresh = 0;
    for (const [group, counts] of this.current) {
      const before = this.before.get(group);
      const previousCount = before?.count ?? 0;
      if (previousCount === 0) fresh += 1;
      else if (counts.count > previousCount) rising += 1;
      else if (counts.count < previousCount) falling += 1;
      rows.push({
        group,
        count: counts.count,
        people: counts.people.size,
        previousCount,
        previousPeople: before?.people.size ?? 0,
      });
    }
    // Groups that had events before and none now went the wrong way too.
    for (const group of this.before.keys()) if (!this.current.has(group)) falling += 1;
    rows.sort((a, b) => b.count - a.count || b.people - a.people || a.group.localeCompare(b.group));
    return {
      kind: "groups",
      rows: rows.slice(0, GROUP_ROW_LIMIT),
      active: this.current.size,
      rising,
      falling,
      new: fresh,
    };
  }
}

export interface GroupReportQuery {
  group: string;
  range: TimeRange;
  interval: Interval;
  /** People whose events don't count, like a project's own maker looking at it. */
  excludePersonIds?: readonly string[];
}

export interface GroupReport {
  group: string;
  totals: {
    views: number;
    /** Unique people who viewed it. */
    people: number;
    sessions: number;
    /** Clicks, submissions and changes on its pages. */
    interactions: number;
  };
  previous: { views: number; people: number };
  series: { buckets: number[]; views: number[]; people: number[] };
  /** Where the visits that viewed it came from: the referring site, or the channel when there's none. */
  sources: WebRow[];
  /** What was clicked on its pages, by name (`data-capture`), link or text. */
  clicks: WebRow[];
  /** The app's own events about it (votes, pledges…), by name. */
  actions: { name: string; count: number; people: number }[];
}

class Tally {
  private readonly rows = new Map<string, { people: Set<string>; count: number }>();

  add(value: string | null, personId: string): void {
    if (!value) return;
    const row = this.rows.get(value) ?? { people: new Set<string>(), count: 0 };
    row.people.add(personId);
    row.count += 1;
    this.rows.set(value, row);
  }

  top(limit = 10): WebRow[] {
    return [...this.rows.entries()]
      .map(([value, row]) => ({ value, visitors: row.people.size, count: row.count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, limit);
  }
}

/**
 * One group's report. Feed its events from `scanRange` with `add`, then
 * the sources of the sessions in `sessionIds` with `addSource`.
 */
export class GroupReportAggregator {
  private readonly previous: TimeRange;
  private readonly excluded: ReadonlySet<string>;
  private readonly buckets: number[];
  private readonly index = new Map<number, number>();
  private readonly seriesViews: number[];
  private readonly seriesPeople: Set<string>[];
  private readonly people = new Set<string>();
  private readonly previousPeople = new Set<string>();
  private readonly viewSessions = new Map<string, string>();
  private readonly clicks = new Tally();
  private readonly sources = new Tally();
  private readonly actions = new Map<string, { count: number; people: Set<string> }>();
  private views = 0;
  private previousViews = 0;
  private interactions = 0;

  constructor(private readonly query: GroupReportQuery) {
    this.previous = previousRange(query.range);
    this.excluded = new Set(query.excludePersonIds ?? []);
    this.buckets = bucketsIn(query.range, query.interval);
    this.buckets.forEach((start, position) => this.index.set(start, position));
    this.seriesViews = this.buckets.map(() => 0);
    this.seriesPeople = this.buckets.map(() => new Set());
  }

  static scanRange(query: GroupReportQuery): TimeRange {
    return { from: previousRange(query.range).from, to: query.range.to };
  }

  /** The sessions that viewed it, to look up where they came from. */
  get sessionIds(): string[] {
    return [...this.viewSessions.keys()];
  }

  add(event: EventRow): void {
    if (event.group !== this.query.group || this.excluded.has(event.personId)) return;
    if (event.timestamp >= this.previous.from && event.timestamp < this.previous.to) {
      if (event.name === EVENTS.pageview) {
        this.previousViews += 1;
        this.previousPeople.add(event.personId);
      }
      return;
    }
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    if (event.name === EVENTS.pageview) {
      this.views += 1;
      this.people.add(event.personId);
      if (event.sessionId) this.viewSessions.set(event.sessionId, event.personId);
      const bucket = this.index.get(bucketStart(event.timestamp, this.query.interval));
      if (bucket !== undefined) {
        this.seriesViews[bucket] = (this.seriesViews[bucket] ?? 0) + 1;
        this.seriesPeople[bucket]?.add(event.personId);
      }
      return;
    }
    if (event.name === EVENTS.autocapture || event.name === EVENTS.rageclick) {
      this.interactions += 1;
      if (stringProperty(event.properties, "eventType") === "click" || event.name === EVENTS.rageclick) {
        const what =
          stringProperty(event.properties, "captureName") ??
          stringProperty(event.properties, "href") ??
          stringProperty(event.properties, "text");
        this.clicks.add(what, event.personId);
      }
      return;
    }
    if (event.name.startsWith("$")) return;
    const action = this.actions.get(event.name) ?? { count: 0, people: new Set<string>() };
    action.count += 1;
    action.people.add(event.personId);
    this.actions.set(event.name, action);
  }

  addSource(sessionId: string, source: { referrerDomain: string | null; channel: Channel }): void {
    const personId = this.viewSessions.get(sessionId);
    if (personId !== undefined) this.sources.add(source.referrerDomain ?? source.channel, personId);
  }

  result(): GroupReport {
    return {
      group: this.query.group,
      totals: {
        views: this.views,
        people: this.people.size,
        sessions: this.viewSessions.size,
        interactions: this.interactions,
      },
      previous: { views: this.previousViews, people: this.previousPeople.size },
      series: {
        buckets: this.buckets,
        views: this.seriesViews,
        people: this.seriesPeople.map((people) => people.size),
      },
      sources: this.sources.top(),
      clicks: this.clicks.top(),
      actions: [...this.actions.entries()]
        .map(([name, action]) => ({ name, count: action.count, people: action.people.size }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    };
  }
}
