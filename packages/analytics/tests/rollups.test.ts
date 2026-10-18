import { describe, expect, it } from "vite-plus/test";
import {
  ANY_EVENT,
  bucketStart,
  DAY_MS,
  DayRollup,
  type EventRow,
  GroupsAggregator,
  type GroupsQuery,
  planRollups,
  previousRange,
  rollupFits,
  type SessionRow,
  type TimeRange,
  TrendsAggregator,
  type TrendsQuery,
  WebAggregator,
  type WebQuery,
} from "../src/shared/insights";

/** Sunday 18 October 2026, 14:30 UTC: mid-day, like a dashboard opened in the afternoon. */
const NOW = Date.UTC(2026, 9, 18, 14, 30);
const TODAY = bucketStart(NOW, "day");
const HOUR = 3_600_000;

/** A small seeded generator, so the data is varied but the same every run. */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

const PATHS = ["/", "/wall", "/@ada/tiltmaze", "/@bo/radio", "/settings"];
const GROUPS: Record<string, string> = { "/@ada/tiltmaze": "slop:tiltmaze", "/@bo/radio": "slop:radio" };

/** 45 days of sessions and events up to `NOW`, some running past midnight. */
function history(): { sessions: SessionRow[]; events: EventRow[] } {
  const next = random(7);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;
  const sessions: SessionRow[] = [];
  const events: EventRow[] = [];
  for (let day = TODAY - 45 * DAY_MS; day <= TODAY; day += DAY_MS) {
    const visits = 3 + Math.floor(next() * 6);
    for (let visit = 0; visit < visits; visit += 1) {
      const personId = `p${Math.floor(next() * 14)}`;
      const sessionId = `${personId}-${day}-${visit}`;
      // Some start late in the evening and run past midnight.
      const startedAt = day + (visit === 0 ? 23 * HOUR + 50 * 60_000 : Math.floor(next() * 23 * HOUR));
      if (startedAt > NOW) continue;
      const pages = 1 + Math.floor(next() * 4);
      let at = startedAt;
      const paths: string[] = [];
      for (let page = 0; page < pages; page += 1) {
        const path = pick(PATHS);
        paths.push(path);
        if (at <= NOW) {
          events.push({
            name: "$pageview",
            personId,
            sessionId,
            timestamp: at,
            path,
            properties: {},
            group: GROUPS[path] ?? null,
          });
          if (next() < 0.4) {
            events.push({ name: "$autocapture", personId, sessionId, timestamp: at + 1_000, path, properties: {} });
          }
        }
        at += Math.floor(next() * 12 * 60_000);
      }
      sessions.push({
        sessionId,
        personId,
        startedAt,
        endedAt: Math.min(at, NOW),
        pageviews: pages,
        interactions: next() < 0.5 ? 0 : 1,
        entryPath: paths[0] ?? null,
        exitPath: paths.at(-1) ?? null,
        channel: pick(["direct", "search", "social"] as const),
        referrerDomain: pick([null, "google.com", "bsky.app"]),
        utmSource: pick([null, null, "newsletter"]),
        utmCampaign: pick([null, "launch"]),
        browser: pick(["Chrome", "Safari", null]),
        os: pick(["macOS", "iOS"]),
        deviceType: pick(["desktop", "mobile", null] as const),
        country: pick(["GB", "NG", null, ""]),
      });
    }
  }
  return { sessions, events };
}

const { sessions: SESSIONS, events: EVENTS_ } = history();

/** Every past day but two, as if the cron missed them: those are read raw in the middle of a range. */
const ROLLED = new Set(
  Array.from({ length: 46 }, (_, index) => TODAY - (index + 1) * DAY_MS).filter(
    (day) => day !== TODAY - 4 * DAY_MS && day !== TODAY - 33 * DAY_MS,
  ),
);

function rollups(): Map<number, ReturnType<DayRollup["result"]>> {
  const days = new Map<number, DayRollup>();
  const of = (at: number) => {
    const day = bucketStart(at, "day");
    let rollup = days.get(day);
    if (!rollup) {
      rollup = new DayRollup(day);
      days.set(day, rollup);
    }
    return rollup;
  };
  for (const session of SESSIONS) of(session.startedAt).addSession(session);
  for (const event of EVENTS_) of(event.timestamp).addEvent(event);
  return new Map([...days].map(([day, rollup]) => [day, rollup.result()]));
}

const DAYS = rollups();
const inSpans = (spans: readonly TimeRange[], at: number) => spans.some((span) => at >= span.from && at < span.to);

/** Whole days up to and including now, the way the dashboards ask. */
const lastDays = (days: number): TimeRange => ({ from: NOW + 1 - days * DAY_MS, to: NOW + 1 });

function web(query: WebQuery, rolled: boolean) {
  const aggregator = new WebAggregator(query);
  const plan = planRollups(WebAggregator.scanRange(query), rolled ? ROLLED : new Set(), (day) =>
    WebAggregator.rollupDay(query, day),
  );
  for (const day of plan.days) {
    const rows = DAYS.get(day);
    if (rows) aggregator.addDay(rows.web);
  }
  for (const session of SESSIONS) if (inSpans(plan.raw, session.startedAt)) aggregator.addSession(session);
  for (const event of EVENTS_) if (inSpans(plan.raw, event.timestamp)) aggregator.addPageview(event);
  return { result: aggregator.result(), rolledDays: plan.days.length };
}

function trends(query: TrendsQuery, rolled: boolean) {
  const aggregator = new TrendsAggregator(query);
  const plan = planRollups(TrendsAggregator.scanRange(query), rolled ? ROLLED : new Set(), (day) =>
    TrendsAggregator.rollupDay(query, day),
  );
  const fromRollups = new Set(plan.days);
  query.series.forEach((series, index) => {
    const rolling = TrendsAggregator.rollupSeries(query, index);
    if (rolling) {
      for (const day of plan.days) {
        const row = DAYS.get(day)?.events.find((event) => event.name === series.event);
        if (row) aggregator.addDay(index, row);
      }
    }
    for (const event of EVENTS_) {
      if (series.event !== ANY_EVENT && event.name !== series.event) continue;
      if (rolling && fromRollups.has(bucketStart(event.timestamp, "day"))) continue;
      aggregator.add(index, event);
    }
  });
  return aggregator.result();
}

function groups(query: GroupsQuery, rolled: boolean) {
  const aggregator = new GroupsAggregator(query);
  const plan = planRollups(GroupsAggregator.scanRange(query), rolled ? ROLLED : new Set(), (day) =>
    GroupsAggregator.rollupDay(query, day),
  );
  for (const day of plan.days) for (const row of DAYS.get(day)?.groups ?? []) aggregator.addDay(row);
  for (const event of EVENTS_) {
    if (event.name === query.event && inSpans(plan.raw, event.timestamp)) aggregator.add(event);
  }
  return aggregator.result();
}

describe("planning a range", () => {
  it("reads whole rolled-up days from rollups and the partial days, today and gaps raw", () => {
    const range = { from: TODAY - 3 * DAY_MS + 5 * HOUR, to: NOW };
    const rolled = new Set([TODAY - 3 * DAY_MS, TODAY - 2 * DAY_MS, TODAY - DAY_MS]);
    const plan = planRollups(range, rolled, (day) => day !== TODAY - 2 * DAY_MS);
    expect(plan.days).toEqual([TODAY - DAY_MS]);
    expect(plan.raw).toEqual([
      { from: range.from, to: TODAY - DAY_MS },
      { from: TODAY, to: NOW },
    ]);
  });

  it("reads everything raw when nothing is rolled up", () => {
    const range = { from: TODAY - 3 * DAY_MS, to: NOW };
    expect(planRollups(range, new Set(), () => true)).toEqual({ days: [], raw: [range] });
  });

  it("starts with a day that begins exactly at the range's start", () => {
    const range = { from: TODAY - 2 * DAY_MS, to: TODAY };
    expect(planRollups(range, new Set([TODAY - 2 * DAY_MS, TODAY - DAY_MS]), () => true)).toEqual({
      days: [TODAY - 2 * DAY_MS, TODAY - DAY_MS],
      raw: [],
    });
  });
});

describe("rollups agree with raw rows", () => {
  it("for web analytics, by day, week and month, and the period before", () => {
    for (const [days, interval] of [
      [7, "day"],
      [30, "day"],
      [30, "week"],
      [40, "month"],
    ] as const) {
      const query: WebQuery = { kind: "web", range: lastDays(days), interval };
      const rolled = web(query, true);
      // Most of it really came from rollups: every whole day but the gaps.
      expect(rolled.rolledDays).toBeGreaterThan(days);
      expect(rolled.result).toEqual(web(query, false).result);
    }
  });

  it("for web analytics over a range that isn't whole days, reading the period before raw", () => {
    const query: WebQuery = { kind: "web", range: { from: NOW - 20 * DAY_MS - 5 * HOUR, to: NOW }, interval: "day" };
    const rolled = web(query, true);
    // The 19 whole days in the range, less the gap four days ago; none of the period before.
    expect(rolled.rolledDays).toBe(18);
    expect(rolled.result).toEqual(web(query, false).result);
  });

  it("for trends of events and people, with any event and the period before", () => {
    const query: TrendsQuery = {
      kind: "trends",
      range: lastDays(30),
      interval: "day",
      compare: true,
      series: [
        { event: "$pageview", math: "total" },
        { event: "$pageview", math: "persons" },
        { event: "$autocapture", math: "persons" },
        { event: ANY_EVENT, math: "total" },
        // Read raw: filters, and sessions, aren't in rollups.
        { event: "$pageview", math: "total", filters: [{ key: "path", operator: "equals", value: "/wall" }] },
        { event: "$pageview", math: "sessions" },
      ],
    };
    expect(trends(query, true)).toEqual(trends(query, false));
    for (const interval of ["week", "month"] as const) {
      const weekly = { ...query, interval, range: lastDays(40) };
      expect(trends(weekly, true)).toEqual(trends(weekly, false));
    }
  });

  it("for every group's page views against the period before", () => {
    for (const days of [7, 20]) {
      const query: GroupsQuery = { kind: "groups", range: lastDays(days), event: "$pageview", prefix: "slop:" };
      const rolled = groups(query, true);
      expect(rolled.rows.length).toBeGreaterThan(0);
      expect(rolled).toEqual(groups(query, false));
    }
  });
});

describe("rollup rows", () => {
  it("count each day once: sessions by when they started, events by when they happened", () => {
    const day = TODAY - 10 * DAY_MS;
    const rows = DAYS.get(day);
    const events = EVENTS_.filter((event) => bucketStart(event.timestamp, "day") === day);
    const sessions = SESSIONS.filter((session) => bucketStart(session.startedAt, "day") === day);
    expect(rows?.web.sessions).toBe(sessions.length);
    expect(rows?.web.pageviews).toBe(events.filter((event) => event.name === "$pageview").length);
    expect(rows?.events.find((row) => row.name === ANY_EVENT)?.count).toBe(events.length);
    expect(new Set(rows?.web.visitors.map((position) => rows.web.people[position]))).toEqual(
      new Set(sessions.map((session) => session.personId)),
    );
  });

  it("refuse days that don't start at midnight", () => {
    expect(() => new DayRollup(TODAY + HOUR)).toThrow("UTC midnight");
  });

  it("don't fit when a day has more people than a Convex array holds", () => {
    const day = TODAY - DAY_MS;
    const rollup = new DayRollup(day);
    for (let index = 0; index < 8_193; index += 1) {
      rollup.addEvent({
        name: "signed up",
        personId: `p${index}`,
        sessionId: null,
        timestamp: day,
        path: null,
        properties: {},
      });
    }
    expect(rollupFits(rollup.result())).toBe(false);
    expect(rollupFits(DAYS.get(day) ?? rollup.result())).toBe(true);
  });

  it("only go where they belong", () => {
    const query: WebQuery = { kind: "web", range: lastDays(7), interval: "day" };
    const outside = DAYS.get(TODAY - 30 * DAY_MS);
    if (!outside) throw new Error("expected a rolled-up day");
    expect(() => new WebAggregator(query).addDay(outside.web)).toThrow("isn't wholly in the range");
    const filtered: TrendsQuery = {
      kind: "trends",
      range: lastDays(7),
      interval: "day",
      series: [{ event: "$pageview", math: "total", filters: [{ key: "path", operator: "isSet" }] }],
    };
    const row = DAYS.get(TODAY - DAY_MS)?.events[0];
    if (!row) throw new Error("expected an event row");
    expect(() => new TrendsAggregator(filtered).addDay(0, row)).toThrow("Only series without filters");
    expect(previousRange(lastDays(7)).to).toBe(lastDays(7).from);
  });
});
