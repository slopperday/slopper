// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "../src/component/_generated/api";
import schema from "../src/component/schema";
import type { WireEvent } from "../src/shared/events";
import { DayRollup } from "../src/shared/insights";

const modules = import.meta.glob("../src/component/**/*.ts");

const CONTEXT = {
  device: { browser: "Chrome", browserVersion: "141", os: "macOS", osVersion: "10", deviceType: "desktop" as const },
  ownHost: "slopper.day",
};
const DAY = 86_400_000;
const MINUTE = 60_000;
/** Sunday 18 October 2026, 14:30 UTC. */
const NOW = Date.UTC(2026, 9, 18, 14, 30);
const TODAY = Date.UTC(2026, 9, 18);

let counter = 0;
function event(overrides: Partial<WireEvent> = {}): WireEvent {
  counter += 1;
  return {
    uuid: `uuid-${counter}`,
    name: "$pageview",
    distinctId: "anon-1",
    sessionId: "session-1",
    timestamp: Date.now(),
    path: "/",
    properties: {},
    set: null,
    setOnce: null,
    group: null,
    ...overrides,
  };
}

function setup() {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  return convexTest(schema, modules);
}

type Test = ReturnType<typeof setup>;

async function send(t: Test, events: WireEvent[]) {
  return await t.mutation(api.ingest.batch, { events, context: CONTEXT });
}

async function markers(t: Test) {
  return await t.run(async (ctx) => await ctx.db.query("rollupDays").collect());
}

/** A day's rollup with one page view by `personId`. */
function rows(day: number, personId = "p1") {
  const rollup = new DayRollup(day);
  rollup.addEvent({ name: "$pageview", personId, sessionId: null, timestamp: day + 1, path: "/", properties: {} });
  return rollup.result();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("marking days as changed", () => {
  it("marks past days written to, and never today", async () => {
    const t = setup();
    await send(t, [event({ timestamp: NOW - 3 * DAY }), event({ timestamp: NOW - MINUTE })]);
    expect((await markers(t)).map(({ day, rolledAt }) => ({ day, rolledAt }))).toEqual([
      { day: TODAY - 3 * DAY, rolledAt: null },
    ]);
  });

  it("marks the day a session started on when it carries on past midnight", async () => {
    const t = setup();
    vi.setSystemTime(TODAY - 5 * MINUTE);
    await send(t, [event({ sessionId: "late", timestamp: TODAY - 5 * MINUTE })]);
    expect(await markers(t)).toEqual([]);
    vi.setSystemTime(TODAY + 10 * MINUTE);
    await send(t, [event({ sessionId: "late", timestamp: TODAY + 10 * MINUTE })]);
    expect((await markers(t)).map((marker) => marker.day)).toEqual([TODAY - DAY]);
  });

  it("marks the days of events and sessions moved by a merge", async () => {
    const t = setup();
    await t.mutation(api.ingest.capture, { name: "signed up", distinctId: "account", identified: true });
    await send(t, [event({ distinctId: "browser", sessionId: "before", timestamp: NOW - 2 * DAY })]);
    await t.run(async (ctx) => {
      for (const marker of await ctx.db.query("rollupDays").collect()) await ctx.db.delete(marker._id);
    });
    await send(t, [
      event({
        name: "$identify",
        distinctId: "account",
        sessionId: "now",
        properties: { anonDistinctId: "browser" },
      }),
    ]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await markers(t)).map((marker) => marker.day)).toEqual([TODAY - 2 * DAY]);
  });

  it("marks the days of a forgotten person's events", async () => {
    const t = setup();
    await send(t, [event({ distinctId: "leaving", timestamp: NOW - 2 * DAY })]);
    const day = TODAY - 2 * DAY;
    vi.setSystemTime(NOW + 10 * MINUTE);
    expect(await t.mutation(api.rollups.write, { day, startedAt: Date.now(), rows: rows(day) })).toBe("rolled");
    await t.mutation(api.persons.forget, { distinctId: "leaving" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(api.rollups.days, { from: day, to: TODAY })).toEqual([]);
  });
});

describe("writing a day's rollup", () => {
  it("only once the day is over and settled", async () => {
    const t = setup();
    await expect(t.mutation(api.rollups.write, { day: TODAY, startedAt: NOW, rows: rows(TODAY) })).rejects.toThrow(
      "once it's over",
    );
    await expect(
      t.mutation(api.rollups.write, { day: TODAY - DAY, startedAt: TODAY + MINUTE, rows: rows(TODAY - DAY) }),
    ).rejects.toThrow("once it's over");
    await expect(
      t.mutation(api.rollups.write, { day: TODAY - DAY, startedAt: NOW, rows: rows(TODAY - 2 * DAY) }),
    ).rejects.toThrow("for that day");
  });

  it("leaves a day that changed while it was read for next time", async () => {
    const t = setup();
    const day = TODAY - DAY;
    await send(t, [event({ timestamp: day + MINUTE })]);
    expect(await t.mutation(api.rollups.write, { day, startedAt: NOW, rows: rows(day) })).toBe("changed");
    expect(await t.query(api.rollups.days, { from: day, to: TODAY })).toEqual([]);
    vi.setSystemTime(NOW + 10 * MINUTE);
    expect(await t.mutation(api.rollups.write, { day, startedAt: Date.now(), rows: rows(day) })).toBe("rolled");
    expect(await t.query(api.rollups.days, { from: day, to: TODAY })).toEqual([day]);
  });

  it("replaces what the day had, so rolling up again is safe", async () => {
    const t = setup();
    const day = TODAY - DAY;
    for (const personId of ["p1", "p2"]) {
      expect(await t.mutation(api.rollups.write, { day, startedAt: NOW, rows: rows(day, personId) })).toBe("rolled");
    }
    const page = { from: day, to: TODAY, cursor: null, numItems: 10 };
    const web = await t.query(api.rollups.web, page);
    expect(web.page.map((row) => row.people)).toEqual([["p2"]]);
    const events = await t.query(api.rollups.events, { name: "$pageview", ...page });
    expect(events.page.map((row) => row.people)).toEqual([["p2"]]);
  });

  it("marks a day too busy to roll up, and leaves it be until it changes", async () => {
    const t = setup();
    const day = TODAY - 2 * DAY;
    expect(await t.mutation(api.rollups.write, { day, startedAt: NOW, rows: null })).toBe("oversized");
    const window = { from: TODAY - 3 * DAY, to: TODAY, limit: 10 };
    expect(await t.query(api.rollups.pending, window)).toEqual([TODAY - 3 * DAY, TODAY - DAY]);
    expect(await t.query(api.rollups.days, { from: day, to: TODAY })).toEqual([]);
    vi.setSystemTime(NOW + MINUTE);
    await send(t, [event({ timestamp: day + MINUTE })]);
    expect(await t.query(api.rollups.pending, window)).toEqual([TODAY - 3 * DAY, day, TODAY - DAY]);
  });
});

describe("pending days", () => {
  it("are recent days without a rollup, and older days that changed since theirs", async () => {
    const t = setup();
    const old = TODAY - 30 * DAY;
    for (const day of [old, TODAY - 2 * DAY]) {
      expect(await t.mutation(api.rollups.write, { day, startedAt: NOW, rows: rows(day) })).toBe("rolled");
    }
    const window = { from: TODAY - 3 * DAY, to: TODAY, limit: 10 };
    expect(await t.query(api.rollups.pending, window)).toEqual([TODAY - 3 * DAY, TODAY - DAY]);
    // A batch a month late is refused at the endpoint; a server capture can still land there.
    vi.setSystemTime(NOW + MINUTE);
    await t.mutation(api.ingest.capture, { name: "pledged", distinctId: "fan", timestamp: old + MINUTE });
    expect(await t.query(api.rollups.pending, window)).toEqual([old, TODAY - 3 * DAY, TODAY - DAY]);
    expect(await t.query(api.rollups.pending, { ...window, limit: 1 })).toEqual([old]);
  });
});

describe("sweeping", () => {
  it("deletes rollups with the events they came from", async () => {
    const t = setup();
    for (const day of [TODAY - 40 * DAY, TODAY - 2 * DAY]) {
      await t.mutation(api.rollups.write, { day, startedAt: NOW, rows: rows(day) });
    }
    await t.mutation(api.maintenance.sweep, { retention: { eventDays: 30, personDays: 30 } });
    expect(await t.query(api.rollups.days, { from: 0, to: TODAY })).toEqual([TODAY - 2 * DAY]);
    const page = { from: 0, to: TODAY, cursor: null, numItems: 10 };
    expect((await t.query(api.rollups.web, page)).page.map((row) => row.day)).toEqual([TODAY - 2 * DAY]);
    expect((await t.query(api.rollups.groups, page)).page).toEqual([]);
  });

  it("deletes old events name by name, and a name once nothing uses it", async () => {
    const t = setup();
    await t.mutation(api.ingest.capture, { name: "gone", distinctId: "a", timestamp: NOW - 40 * DAY });
    await t.mutation(api.ingest.capture, { name: "kept", distinctId: "a", timestamp: NOW - 40 * DAY });
    await t.mutation(api.ingest.capture, { name: "kept", distinctId: "a", timestamp: NOW - DAY });
    await t.mutation(api.maintenance.sweep, { retention: { eventDays: 30, personDays: 60 } });
    const { events, names } = await t.run(async (ctx) => ({
      events: await ctx.db.query("events").collect(),
      names: await ctx.db.query("eventDefinitions").collect(),
    }));
    expect(events.map((row) => [row.name, row.timestamp])).toEqual([["kept", NOW - DAY]]);
    expect(names.map((row) => row.name)).toEqual(["kept"]);
  });
});
