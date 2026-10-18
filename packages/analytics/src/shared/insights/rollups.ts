import { EVENTS } from "../events";
import { ANY_EVENT } from "./queries";
import type { EventRow, SessionRow } from "./rows";
import { bucketStart, DAY_MS, type TimeRange, wholeDayIn } from "./time";
import { bounced, WEB_BREAKDOWN_KEYS, type WebBreakdownKey } from "./web";

/**
 * Daily rollups: one UTC day of events and sessions boiled down to what the
 * dashboards show, so a 30-day chart reads 30 small rows per series instead
 * of every event. Unique people can't be added up across days, so rollups
 * keep who was counted, not just how many: merging days' people gives the
 * same unique counts as reading the raw rows.
 */

/**
 * How long a day stays quiet before it's rolled up, and how long before a
 * roll-up began a change still spoils it: a write in flight when the
 * roll-up started may land after its reads.
 */
export const ROLLUP_SETTLE_MS = 5 * 60_000;

/** One breakdown value on one day: what it counted, and who (positions in the day's `people`). */
export interface WebDayRow {
  value: string;
  count: number;
  people: number[];
}

/** One day of web analytics: everything `WebAggregator` needs for the day. */
export interface WebDay {
  /** The day's UTC midnight. */
  day: number;
  /** Everyone the day counted, once each; the rest of the row refers to them by position. */
  people: string[];
  /** Who started sessions this day. */
  visitors: number[];
  sessions: number;
  pageviews: number;
  /** Every session's length, added up. */
  durationMs: number;
  bounces: number;
  breakdowns: Record<WebBreakdownKey, WebDayRow[]>;
}

/** One event name on one day (`ANY_EVENT` for every event): how often, and by whom. */
export interface EventDay {
  day: number;
  name: string;
  count: number;
  people: string[];
}

/** One group's page views on one day. */
export interface GroupDay {
  day: number;
  group: string;
  count: number;
  people: string[];
}

export interface DayRollupRows {
  web: WebDay;
  events: EventDay[];
  groups: GroupDay[];
}

interface Counted<Id> {
  count: number;
  people: Set<Id>;
}

function count<Key, Id>(rows: Map<Key, Counted<Id>>, key: Key, personId: Id): void {
  const row = rows.get(key) ?? { count: 0, people: new Set<Id>() };
  row.count += 1;
  row.people.add(personId);
  rows.set(key, row);
}

/**
 * Builds one day's rollup from its sessions (by when they started) and its
 * events, fed in any order. It counts exactly what the aggregators count
 * for those rows, so a rolled-up day and its raw rows give the same answers.
 */
export class DayRollup {
  private readonly range: TimeRange;
  private readonly positions = new Map<string, number>();
  private readonly visitors = new Set<number>();
  private sessions = 0;
  private pageviews = 0;
  private durationMs = 0;
  private bounces = 0;
  private readonly breakdowns = new Map<WebBreakdownKey, Map<string, Counted<number>>>(
    WEB_BREAKDOWN_KEYS.map((key) => [key, new Map()]),
  );
  private readonly events = new Map<string, Counted<string>>();
  private readonly groups = new Map<string, Counted<string>>();

  constructor(readonly day: number) {
    if (bucketStart(day, "day") !== day) throw new Error("A rollup's day starts at UTC midnight.");
    this.range = { from: day, to: day + DAY_MS };
  }

  private position(personId: string): number {
    let position = this.positions.get(personId);
    if (position === undefined) {
      position = this.positions.size;
      this.positions.set(personId, position);
    }
    return position;
  }

  private tally(key: WebBreakdownKey, value: string | null, person: number): void {
    // Like the web breakdowns: rows without a value aren't listed.
    if (value === null || value === "") return;
    const rows = this.breakdowns.get(key);
    if (rows) count(rows, value, person);
  }

  private inDay(at: number): boolean {
    return at >= this.range.from && at < this.range.to;
  }

  addSession(session: SessionRow): void {
    if (!this.inDay(session.startedAt)) return;
    const person = this.position(session.personId);
    this.visitors.add(person);
    this.sessions += 1;
    this.durationMs += Math.max(0, session.endedAt - session.startedAt);
    if (bounced(session)) this.bounces += 1;
    this.tally("entryPages", session.entryPath, person);
    this.tally("exitPages", session.exitPath, person);
    this.tally("channels", session.channel, person);
    this.tally("referrers", session.referrerDomain, person);
    this.tally("utmSources", session.utmSource, person);
    this.tally("utmCampaigns", session.utmCampaign, person);
    this.tally("browsers", session.browser, person);
    this.tally("operatingSystems", session.os, person);
    this.tally("devices", session.deviceType, person);
    this.tally("countries", session.country, person);
  }

  addEvent(event: EventRow): void {
    if (!this.inDay(event.timestamp)) return;
    count(this.events, event.name, event.personId);
    count(this.events, ANY_EVENT, event.personId);
    if (event.name !== EVENTS.pageview) return;
    this.pageviews += 1;
    this.tally("pages", event.path, this.position(event.personId));
    if (event.group) count(this.groups, event.group, event.personId);
  }

  result(): DayRollupRows {
    const rows = (key: WebBreakdownKey): WebDayRow[] =>
      [...(this.breakdowns.get(key) ?? [])].map(([value, row]) => ({
        value,
        count: row.count,
        people: [...row.people],
      }));
    const breakdowns: Record<WebBreakdownKey, WebDayRow[]> = {
      pages: rows("pages"),
      entryPages: rows("entryPages"),
      exitPages: rows("exitPages"),
      channels: rows("channels"),
      referrers: rows("referrers"),
      utmSources: rows("utmSources"),
      utmCampaigns: rows("utmCampaigns"),
      browsers: rows("browsers"),
      operatingSystems: rows("operatingSystems"),
      devices: rows("devices"),
      countries: rows("countries"),
    };
    const { day } = this;
    return {
      web: {
        day,
        people: [...this.positions.keys()],
        visitors: [...this.visitors],
        sessions: this.sessions,
        pageviews: this.pageviews,
        durationMs: this.durationMs,
        bounces: this.bounces,
        breakdowns,
      },
      events: [...this.events].map(([name, row]) => ({ day, name, count: row.count, people: [...row.people] })),
      groups: [...this.groups].map(([group, row]) => ({ day, group, count: row.count, people: [...row.people] })),
    };
  }
}

/** What to read for a range: days from their rollups, and the rest as raw rows. */
export interface RollupPlan {
  /** Rolled-up days to read, in order. */
  days: number[];
  /** What's left, in order: the partial days at either end, today, and any day not rolled up. */
  raw: TimeRange[];
}

/**
 * Splits `range` into the whole days that can come from rollups (rolled up,
 * and `usable` for the query) and the spans in between, read raw.
 */
export function planRollups(
  range: TimeRange,
  rolled: ReadonlySet<number>,
  usable: (day: number) => boolean,
): RollupPlan {
  const days: number[] = [];
  const raw: TimeRange[] = [];
  let rawFrom = range.from;
  const firstDay = bucketStart(range.from, "day") === range.from ? range.from : bucketStart(range.from, "day") + DAY_MS;
  for (let day = firstDay; wholeDayIn(day, range); day += DAY_MS) {
    if (!rolled.has(day) || !usable(day)) continue;
    if (rawFrom < day) raw.push({ from: rawFrom, to: day });
    days.push(day);
    rawFrom = day + DAY_MS;
  }
  if (rawFrom < range.to) raw.push({ from: rawFrom, to: range.to });
  return { days, raw };
}

/** Convex's limits on one document: a mebibyte, and 8,192 items in any array. */
const DOCUMENT_BYTES = 1 << 20;
const ARRAY_ITEMS = 8_192;

function arraysFit(value: unknown): boolean {
  if (Array.isArray(value)) return value.length <= ARRAY_ITEMS && value.every(arraysFit);
  if (value !== null && typeof value === "object") return Object.values(value).every(arraysFit);
  return true;
}

/**
 * Whether every row fits in a Convex document, with room to spare. A day
 * too busy for that isn't rolled up, and its dashboards read it raw.
 */
export function rollupFits(rows: DayRollupRows): boolean {
  return [rows.web, ...rows.events, ...rows.groups].every(
    (row) => arraysFit(row) && JSON.stringify(row).length < DOCUMENT_BYTES * 0.9,
  );
}
