import { describe, expect, it } from "vite-plus/test";
import {
  bucketsIn,
  bucketStart,
  bounced,
  DAY_MS,
  type EventRow,
  FunnelAggregator,
  GroupReportAggregator,
  GroupsAggregator,
  LifecycleAggregator,
  matchesFilter,
  PathsAggregator,
  previousRange,
  RetentionAggregator,
  type SessionRow,
  StickinessAggregator,
  TrendsAggregator,
  WebAggregator,
  WEEK_MS,
} from "../src/shared/insights";

/** Monday 12 October 2026, midnight UTC. */
const MONDAY = Date.UTC(2026, 9, 12);
const HOUR = 3_600_000;
const day = (n: number, hours = 12) => MONDAY + n * DAY_MS + hours * HOUR;

function row(overrides: Partial<EventRow> = {}): EventRow {
  return {
    name: "$pageview",
    personId: "p1",
    sessionId: "s1",
    timestamp: day(0),
    path: "/",
    properties: {},
    ...overrides,
  };
}

function session(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    sessionId: "s1",
    personId: "p1",
    startedAt: day(0),
    endedAt: day(0) + 60_000,
    pageviews: 2,
    interactions: 1,
    entryPath: "/",
    exitPath: "/wall",
    channel: "direct",
    referrerDomain: null,
    utmSource: null,
    utmCampaign: null,
    browser: "Chrome",
    os: "macOS",
    deviceType: "desktop",
    country: "GB",
    ...overrides,
  };
}

const WEEK = { from: MONDAY, to: MONDAY + WEEK_MS };

describe("time buckets", () => {
  it("starts days at UTC midnight, weeks on Monday and months on the first", () => {
    const sunday = Date.UTC(2026, 9, 18, 23, 59);
    expect(bucketStart(sunday, "day")).toBe(Date.UTC(2026, 9, 18));
    expect(bucketStart(sunday, "week")).toBe(MONDAY);
    expect(bucketStart(MONDAY, "week")).toBe(MONDAY);
    expect(bucketStart(sunday, "month")).toBe(Date.UTC(2026, 9, 1));
  });

  it("lists every bucket a range touches, across month ends", () => {
    expect(bucketsIn({ from: Date.UTC(2026, 0, 30), to: Date.UTC(2026, 2, 2) }, "month")).toEqual([
      Date.UTC(2026, 0, 1),
      Date.UTC(2026, 1, 1),
      Date.UTC(2026, 2, 1),
    ]);
    expect(bucketsIn(WEEK, "day")).toHaveLength(7);
    expect(previousRange(WEEK)).toEqual({ from: MONDAY - WEEK_MS, to: MONDAY });
  });
});

describe("property filters", () => {
  const event = row({ path: "/wall", properties: { plan: "Pro", seats: 3, tags: ["a", "b"] } });
  it("compares as text, case-insensitively for contains", () => {
    expect(matchesFilter(event, { key: "plan", operator: "equals", value: "Pro" })).toBe(true);
    expect(matchesFilter(event, { key: "plan", operator: "equals", value: "pro" })).toBe(false);
    expect(matchesFilter(event, { key: "plan", operator: "contains", value: "PR" })).toBe(true);
    expect(matchesFilter(event, { key: "plan", operator: "notContains", value: "free" })).toBe(true);
    expect(matchesFilter(event, { key: "tags", operator: "contains", value: "b" })).toBe(true);
    expect(matchesFilter(event, { key: "path", operator: "equals", value: "/wall" })).toBe(true);
  });

  it("knows set, unset and numbers", () => {
    expect(matchesFilter(event, { key: "plan", operator: "isSet" })).toBe(true);
    expect(matchesFilter(event, { key: "missing", operator: "isNotSet" })).toBe(true);
    expect(matchesFilter(event, { key: "missing", operator: "notEquals", value: "x" })).toBe(true);
    expect(matchesFilter(event, { key: "seats", operator: "greaterThan", value: 2 })).toBe(true);
    expect(matchesFilter(event, { key: "seats", operator: "lessThan", value: 2 })).toBe(false);
    expect(matchesFilter(event, { key: "plan", operator: "greaterThan", value: 2 })).toBe(false);
  });
});

describe("trends", () => {
  it("counts events, people and sessions per bucket, with totals that aren't sums", () => {
    const trends = new TrendsAggregator({
      kind: "trends",
      range: WEEK,
      interval: "day",
      series: [
        { event: "$pageview", math: "total" },
        { event: "$pageview", math: "persons" },
        { event: "$pageview", math: "sessions" },
      ],
    });
    const events = [
      row({ timestamp: day(0), personId: "a", sessionId: "a1" }),
      row({ timestamp: day(0, 13), personId: "a", sessionId: "a1" }),
      row({ timestamp: day(1), personId: "a", sessionId: "a2" }),
      row({ timestamp: day(1), personId: "b", sessionId: "b1" }),
      row({ timestamp: day(9), personId: "c" }),
    ];
    for (const event of events) for (const index of [0, 1, 2]) trends.add(index, event);
    const [total, persons, sessions] = trends.result().series;
    expect(total?.data).toEqual([2, 2, 0, 0, 0, 0, 0]);
    expect(total?.total).toBe(4);
    expect(persons?.data).toEqual([1, 2, 0, 0, 0, 0, 0]);
    expect(persons?.total).toBe(2);
    expect(sessions?.data).toEqual([1, 2, 0, 0, 0, 0, 0]);
    expect(sessions?.total).toBe(3);
  });

  it("applies each series' filters", () => {
    const trends = new TrendsAggregator({
      kind: "trends",
      range: WEEK,
      interval: "week",
      series: [{ event: "$pageview", math: "total", filters: [{ key: "path", operator: "equals", value: "/wall" }] }],
    });
    trends.add(0, row({ path: "/wall" }));
    trends.add(0, row({ path: "/" }));
    expect(trends.result().series[0]?.data).toEqual([1]);
  });

  it("splits by a property, keeping the top ten and folding the rest into Other", () => {
    const trends = new TrendsAggregator({
      kind: "trends",
      range: WEEK,
      interval: "week",
      series: [{ event: "voted", math: "persons" }],
      breakdown: "value",
    });
    for (let value = 0; value < 12; value += 1) {
      for (let person = 0; person <= value; person += 1) {
        trends.add(0, row({ name: "voted", personId: `p${person}`, properties: { value: String(value) } }));
      }
    }
    trends.add(0, row({ name: "voted", personId: "nobody-knows" }));
    const { series } = trends.result();
    expect(series).toHaveLength(11);
    expect(series[0]).toMatchObject({ breakdown: "11", total: 12, label: "voted · 11" });
    expect(series.at(-1)).toMatchObject({ breakdown: "Other", label: "voted · Other" });
    // "Other" holds 0, 1 and the event with no value: unique people across them.
    expect(series.at(-1)?.total).toBe(3);
  });

  it("draws an empty line when nothing happened", () => {
    const trends = new TrendsAggregator({
      kind: "trends",
      range: WEEK,
      interval: "day",
      series: [{ event: "nothing", math: "total" }],
    });
    expect(trends.result().series).toEqual([
      { label: "nothing", event: "nothing", math: "total", breakdown: null, data: [0, 0, 0, 0, 0, 0, 0], total: 0 },
    ]);
  });
});

describe("funnels", () => {
  const query = {
    kind: "funnel" as const,
    range: WEEK,
    windowDays: 1,
    steps: [
      { event: "$pageview", filters: [{ key: "path", operator: "equals" as const, value: "/" }] },
      { event: "$pageview", filters: [{ key: "path", operator: "equals" as const, value: "/new" }] },
      { event: "slop launched" },
    ],
  };

  function feed(funnel: FunnelAggregator, events: EventRow[]) {
    for (const event of events) {
      funnel.add(0, event);
      funnel.add(1, event);
      funnel.add(2, event);
    }
  }

  it("counts people through steps in order, within the window", () => {
    const funnel = new FunnelAggregator(query);
    feed(funnel, [
      // a: all the way, an hour apart.
      row({ personId: "a", timestamp: day(0), path: "/" }),
      row({ personId: "a", timestamp: day(0) + HOUR, path: "/new" }),
      row({ personId: "a", name: "slop launched", timestamp: day(0) + 3 * HOUR, path: null }),
      // b: launched before reaching /new, then reached /new: only two steps.
      row({ personId: "b", timestamp: day(1), path: "/" }),
      row({ personId: "b", name: "slop launched", timestamp: day(1) + HOUR, path: null }),
      row({ personId: "b", timestamp: day(1) + 2 * HOUR, path: "/new" }),
      // c: launched two days later, past the window.
      row({ personId: "c", timestamp: day(2), path: "/" }),
      row({ personId: "c", timestamp: day(2) + HOUR, path: "/new" }),
      row({ personId: "c", name: "slop launched", timestamp: day(4), path: null }),
      // d: never entered (/new only).
      row({ personId: "d", timestamp: day(3), path: "/new" }),
    ]);
    const { steps } = funnel.result();
    expect(steps.map((step) => step.count)).toEqual([3, 3, 1]);
    expect(steps[1]?.conversion).toBe(1);
    expect(steps[2]?.conversion).toBeCloseTo(1 / 3);
    expect(steps[2]?.stepConversion).toBeCloseTo(1 / 3);
    expect(steps[0]?.medianMsFromPrevious).toBeNull();
    expect(steps[1]?.medianMsFromPrevious).toBe(HOUR);
    expect(steps[2]?.medianMsFromPrevious).toBe(2 * HOUR);
  });

  it("takes each person's best attempt, and only entries inside the range", () => {
    const funnel = new FunnelAggregator(query);
    feed(funnel, [
      row({ personId: "a", timestamp: day(0), path: "/" }),
      // A second, later attempt that goes all the way.
      row({ personId: "a", timestamp: day(3), path: "/" }),
      row({ personId: "a", timestamp: day(3) + 1, path: "/new" }),
      row({ personId: "a", name: "slop launched", timestamp: day(3) + 2, path: null }),
      // Entered before the range.
      row({ personId: "b", timestamp: MONDAY - HOUR, path: "/" }),
      row({ personId: "b", timestamp: MONDAY, path: "/new" }),
    ]);
    expect(funnel.result().steps.map((step) => step.count)).toEqual([1, 1, 1]);
  });

  it("doesn't count a step done at the same moment as the one before", () => {
    const funnel = new FunnelAggregator({ ...query, steps: [{ event: "a" }, { event: "b" }] });
    funnel.add(0, row({ name: "a", timestamp: day(0) }));
    funnel.add(1, row({ name: "b", timestamp: day(0) }));
    expect(funnel.result().steps.map((step) => step.count)).toEqual([1, 0]);
  });
});

describe("retention", () => {
  it("follows each cohort week by week, leaving off weeks that haven't come", () => {
    const now = MONDAY + 2 * WEEK_MS + DAY_MS;
    const retention = new RetentionAggregator(
      {
        kind: "retention",
        range: { from: MONDAY, to: MONDAY + 2 * WEEK_MS },
        interval: "week",
        startEvent: "signed up",
        returnEvent: "$pageview",
        periods: 4,
      },
      now,
    );
    const start = (personId: string, timestamp: number) =>
      retention.addStart(row({ name: "signed up", personId, timestamp }));
    const back = (personId: string, timestamp: number) => retention.addReturn(row({ personId, timestamp }));
    start("a", day(0));
    start("b", day(1));
    start("c", day(8));
    // a signed up twice: only the first counts.
    start("a", day(9));
    back("a", day(8));
    back("a", day(15));
    back("b", day(2));
    back("c", day(15));
    const { cohorts, average } = retention.result();
    expect(cohorts).toEqual([
      { start: MONDAY, size: 2, retained: [2, 1, 1] },
      { start: MONDAY + WEEK_MS, size: 1, retained: [1, 1] },
    ]);
    expect(average[0]).toBe(1);
    expect(average[1]).toBeCloseTo(2 / 3);
    expect(average[2]).toBe(0.5);
    expect(average[3]).toBe(0);
  });
});

describe("paths", () => {
  const views = (sessionId: string, pages: string[]) =>
    pages.map((path, index) => row({ sessionId, path, timestamp: day(0) + index * 1_000 }));

  it("links pages step by step, collapsing repeats, with where journeys end", () => {
    const paths = new PathsAggregator({ kind: "paths", range: WEEK, steps: 4 });
    for (const event of [
      ...views("s1", ["/", "/wall", "/wall", "/new"]),
      ...views("s2", ["/", "/wall"]),
      ...views("s3", ["/today"]),
    ]) {
      paths.add(event);
    }
    const result = paths.result();
    expect(result.links).toEqual([
      { source: "0:/", target: "1:/wall", sessions: 2 },
      { source: "1:/wall", target: "2:/new", sessions: 1 },
    ]);
    expect(result.nodes.find((node) => node.id === "1:/wall")).toEqual({
      id: "1:/wall",
      step: 1,
      path: "/wall",
      sessions: 2,
      dropoffs: 1,
    });
    expect(result.nodes.find((node) => node.id === "0:/today")?.dropoffs).toBe(1);
    expect(result.journeys[0]).toEqual({ pages: ["/", "/wall"], sessions: 1 });
  });

  it("starts at a page, or leads up to one", () => {
    const from = new PathsAggregator({ kind: "paths", range: WEEK, steps: 2, startPath: "/wall" });
    const to = new PathsAggregator({ kind: "paths", range: WEEK, steps: 2, endPath: "/new" });
    for (const event of [...views("s1", ["/", "/wall", "/new", "/"]), ...views("s2", ["/today"])]) {
      from.add(event);
      to.add(event);
    }
    expect(from.result().journeys).toEqual([{ pages: ["/wall", "/new"], sessions: 1 }]);
    expect(to.result().journeys).toEqual([{ pages: ["/wall", "/new"], sessions: 1 }]);
  });
});

describe("stickiness", () => {
  it("counts how many days each person came back", () => {
    const stickiness = new StickinessAggregator({ kind: "stickiness", range: WEEK, event: "$pageview" });
    for (const timestamp of [day(0), day(0, 14), day(1), day(5)]) stickiness.add(row({ personId: "a", timestamp }));
    stickiness.add(row({ personId: "b", timestamp: day(2) }));
    expect(stickiness.result()).toEqual({ kind: "stickiness", days: 7, persons: [1, 0, 1, 0, 0, 0, 0] });
  });
});

describe("lifecycle", () => {
  it("sorts each week's people into new, returning, resurrecting and dormant", () => {
    const query = {
      kind: "lifecycle" as const,
      range: { from: MONDAY, to: MONDAY + 2 * WEEK_MS },
      interval: "week" as const,
      event: "$pageview",
    };
    expect(LifecycleAggregator.scanRange(query)).toEqual({ from: MONDAY - WEEK_MS, to: MONDAY + 2 * WEEK_MS });
    const lifecycle = new LifecycleAggregator(query);
    const seen = (personId: string, timestamp: number) => lifecycle.add(row({ personId, timestamp }));
    // returning: active the week before and both weeks.
    seen("regular", day(-3));
    seen("regular", day(1));
    seen("regular", day(8));
    // new in week one, gone in week two.
    seen("newbie", day(2));
    // resurrecting in week two after skipping week one.
    seen("lapsed", day(-2));
    seen("lapsed", day(9));
    expect(new Set(lifecycle.people)).toEqual(new Set(["regular", "newbie", "lapsed"]));
    const firstSeen = new Map([
      ["regular", day(-30)],
      ["newbie", day(2)],
      ["lapsed", day(-60)],
    ]);
    expect(lifecycle.result(firstSeen)).toEqual({
      kind: "lifecycle",
      buckets: [MONDAY, MONDAY + WEEK_MS],
      new: [1, 0],
      returning: [1, 1],
      resurrecting: [0, 1],
      dormant: [-1, -1],
    });
  });
});

describe("web analytics", () => {
  it("sums sessions and page views, against the period before", () => {
    const query = { kind: "web" as const, range: WEEK, interval: "day" as const };
    expect(WebAggregator.scanRange(query)).toEqual({ from: MONDAY - WEEK_MS, to: MONDAY + WEEK_MS });
    const web = new WebAggregator(query);
    web.addSession(session({ sessionId: "a1", personId: "a", startedAt: day(0), endedAt: day(0) + 90_000 }));
    web.addSession(
      session({
        sessionId: "a2",
        personId: "a",
        startedAt: day(1),
        endedAt: day(1) + 2_000,
        pageviews: 1,
        interactions: 0,
        entryPath: "/wall",
        exitPath: "/wall",
        channel: "social",
        referrerDomain: "t.co",
        browser: "Safari",
        deviceType: "mobile",
      }),
    );
    web.addSession(session({ sessionId: "b1", personId: "b", startedAt: day(1), endedAt: day(1) + 30_000 }));
    web.addSession(session({ sessionId: "old", personId: "z", startedAt: day(-3) }));
    for (const [personId, path, timestamp] of [
      ["a", "/", day(0)],
      ["a", "/wall", day(0) + 1],
      ["a", "/wall", day(1)],
      ["b", "/", day(1)],
      ["z", "/", day(-3)],
    ] as const) {
      web.addPageview(row({ personId, path, timestamp }));
    }
    web.addPageview(row({ name: "$autocapture" }));

    const result = web.result();
    expect(result.totals).toEqual({
      visitors: 2,
      sessions: 3,
      pageviews: 4,
      averageDurationMs: Math.round((90_000 + 2_000 + 30_000) / 3),
      bounceRate: 1 / 3,
    });
    expect(result.previous).toMatchObject({ visitors: 1, sessions: 1, pageviews: 1 });
    expect(result.series.sessions).toEqual([1, 2, 0, 0, 0, 0, 0]);
    expect(result.series.visitors).toEqual([1, 2, 0, 0, 0, 0, 0]);
    expect(result.series.pageviews).toEqual([2, 2, 0, 0, 0, 0, 0]);
    expect(result.breakdowns.pages).toEqual([
      { value: "/", visitors: 2, count: 2 },
      { value: "/wall", visitors: 1, count: 2 },
    ]);
    expect(result.breakdowns.channels).toEqual([
      { value: "direct", visitors: 2, count: 2 },
      { value: "social", visitors: 1, count: 1 },
    ]);
    expect(result.breakdowns.referrers).toEqual([{ value: "t.co", visitors: 1, count: 1 }]);
    expect(result.breakdowns.devices.map((item) => item.value)).toEqual(["desktop", "mobile"]);
  });

  it("calls a quick one-page visit with no clicks a bounce", () => {
    expect(bounced(session({ pageviews: 1, interactions: 0, endedAt: day(0) + 5_000 }))).toBe(true);
    expect(bounced(session({ pageviews: 1, interactions: 1, endedAt: day(0) + 5_000 }))).toBe(false);
    expect(bounced(session({ pageviews: 1, interactions: 0, endedAt: day(0) + 15_000 }))).toBe(false);
  });
});

describe("groups", () => {
  it("compares every group with the period before: climbing, fading and new", () => {
    const query = { kind: "groups" as const, range: WEEK, event: "$pageview", prefix: "slop:" };
    expect(GroupsAggregator.scanRange(query)).toEqual({ from: MONDAY - WEEK_MS, to: MONDAY + WEEK_MS });
    const groups = new GroupsAggregator(query);
    const view = (group: string | null, personId: string, timestamp: number) =>
      groups.add(row({ group, personId, timestamp }));
    // climbing: 1 view before, 3 now from 2 people.
    view("slop:a", "p1", day(-3));
    view("slop:a", "p1", day(1));
    view("slop:a", "p2", day(2));
    view("slop:a", "p2", day(3));
    // fading: 2 before, 1 now.
    view("slop:b", "p1", day(-5));
    view("slop:b", "p2", day(-4));
    view("slop:b", "p3", day(4));
    // gone: views before, none now.
    view("slop:c", "p1", day(-1));
    // new.
    view("slop:d", "p9", day(5));
    // not a slop, and no group at all.
    view("team:x", "p1", day(1));
    view(null, "p1", day(1));
    const result = groups.result();
    expect(result).toMatchObject({ kind: "groups", active: 3, rising: 1, falling: 2, new: 1 });
    expect(result.rows).toEqual([
      { group: "slop:a", count: 3, people: 2, previousCount: 1, previousPeople: 1 },
      { group: "slop:b", count: 1, people: 1, previousCount: 2, previousPeople: 2 },
      { group: "slop:d", count: 1, people: 1, previousCount: 0, previousPeople: 0 },
    ]);
  });

  it("reports one group: views, people, where they came from, what they clicked and did", () => {
    const query = { group: "slop:a", range: WEEK, interval: "day" as const, excludePersonIds: ["maker"] };
    const report = new GroupReportAggregator(query);
    const about = (overrides: Partial<EventRow>) => report.add(row({ group: "slop:a", ...overrides }));
    about({ personId: "p1", sessionId: "s1", timestamp: day(0) });
    about({ personId: "p1", sessionId: "s1", timestamp: day(0) + 1 });
    about({ personId: "p2", sessionId: "s2", timestamp: day(1) });
    about({ personId: "p0", sessionId: "s0", timestamp: day(-2) });
    // The maker's own visits don't count.
    about({ personId: "maker", sessionId: "m1", timestamp: day(1) });
    about({
      name: "$autocapture",
      personId: "p1",
      properties: { eventType: "click", captureName: "link:website", href: "https://tiltmaze.app/" },
    });
    about({ name: "$autocapture", personId: "p2", properties: { eventType: "click", href: "https://tiltmaze.app/" } });
    about({ name: "$autocapture", personId: "p2", properties: { eventType: "change", name: "amount" } });
    // The site's own navigation, clicked on the page, isn't about the slop.
    about({ name: "$autocapture", personId: "p2", properties: { eventType: "click", href: "/today", text: "Today" } });
    about({ name: "voted", personId: "p1", sessionId: null, path: null });
    about({ name: "voted", personId: "p2", sessionId: null, path: null });
    about({ name: "pledged", personId: "p2", sessionId: null, path: null });
    // Another slop's event.
    report.add(row({ group: "slop:b", personId: "p3" }));
    expect(new Set(report.sessionIds)).toEqual(new Set(["s1", "s2"]));
    report.addSource("s1", { referrerDomain: "news.ycombinator.com", channel: "social" });
    report.addSource("s2", { referrerDomain: null, channel: "direct" });
    report.addSource("elsewhere", { referrerDomain: "t.co", channel: "social" });
    expect(report.result()).toEqual({
      group: "slop:a",
      totals: { views: 3, people: 2, sessions: 2, interactions: 2 },
      previous: { views: 1, people: 1 },
      series: { buckets: bucketsIn(WEEK, "day"), views: [2, 1, 0, 0, 0, 0, 0], people: [1, 1, 0, 0, 0, 0, 0] },
      sources: [
        { value: "direct", visitors: 1, count: 1 },
        { value: "news.ycombinator.com", visitors: 1, count: 1 },
      ],
      clicks: [
        { value: "https://tiltmaze.app/", visitors: 1, count: 1 },
        { value: "link:website", visitors: 1, count: 1 },
      ],
      actions: [
        { name: "voted", count: 2, people: 2 },
        { name: "pledged", count: 1, people: 1 },
      ],
    });
  });
});
