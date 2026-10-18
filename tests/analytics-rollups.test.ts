// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, components, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { InsightQuery } from "@slopperday/analytics/shared/insights";
import { convexApp } from "./convexApp";

const DAY = 86_400_000;
const MINUTE = 60_000;
/** Sunday 18 October 2026, 14:30 UTC: the dashboards are opened mid-afternoon. */
const NOW = Date.UTC(2026, 9, 18, 14, 30);
const TODAY = Date.UTC(2026, 9, 18);
const CONTEXT = {
  device: { browser: "Chrome", browserVersion: "141", os: "macOS", osVersion: "10", deviceType: "desktop" as const },
  ownHost: "slopper.day",
};
const PATHS = ["/", "/wall", "/@ada/tiltmaze", "/@bo/radio"];
const GROUPS: Record<string, string> = { "/@ada/tiltmaze": "slop:tiltmaze", "/@bo/radio": "slop:radio" };

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

type Setup = ReturnType<typeof setup>;

async function admin({ t, server }: Setup): Promise<Id<"users">> {
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "github",
    providerId: "boss",
    preferredUsername: "boss",
    displayName: "boss",
    avatarUrl: null,
    timeZone: "UTC",
  });
  await t.run(async (ctx) => await ctx.db.patch(userId, { role: "admin" }));
  return userId;
}

let counter = 0;
interface Visit {
  distinctId: string;
  sessionId: string;
  at: number;
  paths: string[];
  name?: string;
  properties?: Record<string, string>;
}

/** Stores a visit's events the way the endpoint does, with whatever timestamps it's given. */
async function visit({ t }: Setup, { distinctId, sessionId, at, paths, name, properties }: Visit): Promise<void> {
  const events = paths.flatMap((path, index) => {
    const base = {
      distinctId,
      sessionId,
      path,
      properties: properties ?? {},
      set: null,
      setOnce: null,
      group: GROUPS[path] ?? null,
    };
    counter += 1;
    const view = { ...base, uuid: `view-${counter}`, name: name ?? "$pageview", timestamp: at + index * 3 * MINUTE };
    if (index % 2 === 1) return [view];
    return [view, { ...base, uuid: `click-${counter}`, name: "$autocapture", timestamp: view.timestamp + 1_000 }];
  });
  await t.mutation(components.analytics.ingest.batch, { events, context: CONTEXT });
}

/** Forty days of visits by a dozen people, some running past midnight, a few from search or a newsletter. */
async function seed(setup: Setup): Promise<void> {
  for (let daysAgo = 40; daysAgo >= 0; daysAgo -= 1) {
    const day = TODAY - daysAgo * DAY;
    for (let n = 0; n < 4 + (daysAgo % 5); n += 1) {
      const person = (daysAgo * 7 + n * 3) % 12;
      const at = n === 0 ? day + 23 * 3_600_000 + 55 * MINUTE : day + (n * 2 + (daysAgo % 3)) * 3_600_000;
      if (at > NOW - 10 * MINUTE) continue;
      await visit(setup, {
        distinctId: `visitor-${person}`,
        sessionId: `s-${daysAgo}-${n}`,
        at,
        paths: PATHS.slice(n % 3, (n % 3) + 1 + (daysAgo % 3)),
        properties: n % 4 === 1 ? { referrer: "https://www.google.com/", utmSource: "newsletter" } : {},
      });
    }
  }
}

function rangeOf(days: number, now: number) {
  return { from: now + 1 - days * DAY, to: now + 1 };
}

/** What the dashboards ask for, as of `now`. */
function dashboards(now: number): InsightQuery[] {
  const month = rangeOf(30, now);
  return [
    { kind: "web", range: rangeOf(7, now), interval: "day" },
    { kind: "web", range: month, interval: "day" },
    { kind: "web", range: month, interval: "week" },
    {
      kind: "trends",
      range: month,
      interval: "day",
      compare: true,
      series: [
        { event: "$pageview", math: "total" },
        { event: "$pageview", math: "persons" },
        { event: "$autocapture", math: "persons" },
        { event: "*", math: "total" },
      ],
    },
    // Read raw: a filter and sessions aren't in rollups, next to a series that is.
    {
      kind: "trends",
      range: month,
      interval: "week",
      series: [
        { event: "$pageview", math: "total" },
        { event: "$pageview", math: "total", filters: [{ key: "path", operator: "equals", value: "/wall" }] },
        { event: "$pageview", math: "sessions" },
      ],
    },
    { kind: "groups", range: month, event: "$pageview", prefix: "slop:" },
    { kind: "groups", range: rangeOf(7, now), event: "$pageview", prefix: "slop:" },
  ];
}

async function answers({ server }: Setup, adminId: Id<"users">, now: number) {
  const found = [];
  for (const query of dashboards(now)) found.push(await server.action(api.analytics.insight, { adminId, query }));
  return found;
}

async function rollUp({ t }: Setup, lookbackDays: number): Promise<void> {
  await t.action(internal.analytics.rollUp, { lookbackDays });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}

describe("daily rollups", () => {
  it("give the dashboards the same answers as raw events, reading far fewer rows", async () => {
    const context = setup();
    const adminId = await admin(context);
    await seed(context);
    const raw = await answers(context, adminId, NOW);

    vi.setSystemTime(NOW + 10 * MINUTE);
    await rollUp(context, 60);
    const rolled = await context.t.query(components.analytics.rollups.days, { from: 0, to: TODAY });
    // Every day of the 60 looked back over, up to yesterday.
    expect(rolled).toHaveLength(60);
    const fromRollups = await answers(context, adminId, NOW);
    expect(fromRollups.map((answer) => answer.result)).toEqual(raw.map((answer) => answer.result));
    // The 30-day web overview read today and the days at either end of each period, nothing else.
    const [, month] = fromRollups;
    const [, monthRaw] = raw;
    expect(month?.scanned).toBeLessThan((monthRaw?.scanned ?? 0) / 5);
  });

  it("read a day raw once it changes after its roll-up, and roll it up again", async () => {
    const context = setup();
    const adminId = await admin(context);
    await seed(context);
    vi.setSystemTime(NOW + 10 * MINUTE);
    await rollUp(context, 60);
    const web = { kind: "web" as const, range: rangeOf(7, NOW), interval: "day" as const };
    const before = await context.server.action(api.analytics.insight, { adminId, query: web });

    // A phone that was offline sends three days' old page views.
    vi.setSystemTime(NOW + 20 * MINUTE);
    await visit(context, { distinctId: "offline", sessionId: "offline-1", at: TODAY - 3 * DAY, paths: ["/", "/"] });
    const days = await context.t.query(components.analytics.rollups.days, { from: TODAY - 4 * DAY, to: TODAY });
    expect(days).not.toContain(TODAY - 3 * DAY);
    const after = await context.server.action(api.analytics.insight, { adminId, query: web });
    if (before.result.kind !== "web" || after.result.kind !== "web") throw new Error("expected web analytics");
    expect(after.result.totals.pageviews).toBe(before.result.totals.pageviews + 2);
    expect(after.result.totals.visitors).toBe(before.result.totals.visitors + 1);

    // The next night's roll-up does the day again, and the answer stays the same.
    vi.setSystemTime(NOW + DAY);
    await rollUp(context, 8);
    expect(await context.t.query(components.analytics.rollups.days, { from: TODAY - 4 * DAY, to: TODAY })).toContain(
      TODAY - 3 * DAY,
    );
    const again = await context.server.action(api.analytics.insight, { adminId, query: web });
    expect(again.result).toEqual(after.result);
  });

  it("count someone once after their earlier visits merge into their account", async () => {
    const context = setup();
    const adminId = await admin(context);
    // Browsing three days ago, before signing up; rolled up while still anonymous.
    await visit(context, { distinctId: "browser", sessionId: "anon", at: TODAY - 3 * DAY, paths: ["/wall"] });
    vi.setSystemTime(NOW + 10 * MINUTE);
    await rollUp(context, 8);
    await context.t.mutation(components.analytics.ingest.capture, {
      name: "signed up",
      distinctId: "account",
      identified: true,
    });
    await visit(context, {
      distinctId: "account",
      sessionId: "signed-in",
      at: NOW + 10 * MINUTE,
      paths: ["/"],
      name: "$identify",
      properties: { anonDistinctId: "browser" },
    });
    await context.t.finishAllScheduledFunctions(vi.runAllTimers);
    const web = await context.server.action(api.analytics.insight, {
      adminId,
      query: { kind: "web", range: rangeOf(7, NOW + 11 * MINUTE), interval: "day" },
    });
    if (web.result.kind !== "web") throw new Error("expected web analytics");
    expect(web.result.totals).toMatchObject({ visitors: 1, sessions: 2 });
  });
});
