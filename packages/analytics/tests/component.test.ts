// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "../src/component/_generated/api";
import schema from "../src/component/schema";
import type { WireEvent } from "../src/shared/events";

const modules = import.meta.glob("../src/component/**/*.ts");

const DESKTOP = {
  browser: "Chrome",
  browserVersion: "141",
  os: "macOS",
  osVersion: "10",
  deviceType: "desktop" as const,
};
const CONTEXT = { device: DESKTOP, ownHost: "slopper.day" };
const MINUTE = 60_000;
const DAY = 86_400_000;

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
  return convexTest(schema, modules);
}

type Test = ReturnType<typeof setup>;

async function send(t: Test, events: WireEvent[], accountId: string | undefined = "user-1") {
  return await t.mutation(api.ingest.batch, { events, context: CONTEXT, accountId });
}

async function all(t: Test) {
  return await t.run(async (ctx) => ({
    persons: await ctx.db.query("persons").collect(),
    distinctIds: await ctx.db.query("distinctIds").collect(),
    sessions: await ctx.db.query("sessions").collect(),
    events: await ctx.db.query("events").collect(),
  }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("ingest", () => {
  it("stores events with a person and a session made on first sight", async () => {
    const t = setup();
    const start = Date.now() - 10 * MINUTE;
    const result = await send(t, [
      event({
        timestamp: start,
        path: "/",
        properties: {
          referrer: "https://news.ycombinator.com/item?id=1",
          utmCampaign: "launch",
          country: "GB",
          viewportWidth: 1280,
        },
      }),
      event({ name: "$autocapture", timestamp: start + MINUTE, path: "/", properties: { eventType: "click" } }),
      event({ timestamp: start + 2 * MINUTE, path: "/wall" }),
    ]);
    expect(result).toEqual({ stored: 3, duplicates: 0, throttled: 0 });

    const { persons, distinctIds, sessions, events } = await all(t);
    expect(events).toHaveLength(3);
    expect(persons).toHaveLength(1);
    expect(persons[0]).toMatchObject({
      createdAt: start,
      identified: false,
      initialPath: "/",
      initialSource: { referrerDomain: "news.ycombinator.com", channel: "social", utmCampaign: "launch" },
    });
    expect(distinctIds.map((row) => row.distinctId)).toEqual(["anon-1"]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      sessionId: "session-1",
      personId: persons[0]?._id,
      startedAt: start,
      endedAt: start + 2 * MINUTE,
      events: 3,
      pageviews: 2,
      interactions: 1,
      entryPath: "/",
      exitPath: "/wall",
      country: "GB",
      viewportWidth: 1280,
      device: DESKTOP,
      source: { channel: "social", referrerDomain: "news.ycombinator.com" },
    });
    expect(events.every((row) => row.personId === persons[0]?._id)).toBe(true);
  });

  it("stores a batch sent twice once", async () => {
    const t = setup();
    const batch = [event(), event({ name: "$autocapture" })];
    await send(t, batch);
    expect(await send(t, batch)).toEqual({ stored: 0, duplicates: 2, throttled: 0 });
    const { events, sessions } = await all(t);
    expect(events).toHaveLength(2);
    expect(sessions[0]?.events).toBe(2);
  });

  it("keeps a session's entry and exit right when batches arrive out of order", async () => {
    const t = setup();
    const start = Date.now() - 30 * MINUTE;
    await send(t, [event({ timestamp: start + 5 * MINUTE, path: "/second" })]);
    await send(t, [event({ timestamp: start, path: "/first" })]);
    await send(t, [event({ timestamp: start + 2 * MINUTE, path: "/middle" })]);
    const [session] = (await all(t)).sessions;
    expect(session).toMatchObject({
      startedAt: start,
      endedAt: start + 5 * MINUTE,
      entryPath: "/first",
      exitPath: "/second",
      pageviews: 3,
    });
  });

  it("starts a session where a page left open was clicked", async () => {
    const t = setup();
    await send(t, [event({ name: "$autocapture", sessionId: "later", path: "/slop/1" })]);
    const [session] = (await all(t)).sessions;
    expect(session).toMatchObject({ entryPath: "/slop/1", exitPath: "/slop/1", pageviews: 0, interactions: 1 });
  });

  it("sets person properties, and set-once ones only once", async () => {
    const t = setup();
    await send(t, [event({ set: { plan: "free" }, setOnce: { firstPlan: "free" } })]);
    await send(t, [event({ set: { plan: "pro" }, setOnce: { firstPlan: "pro" } })]);
    const [person] = (await all(t)).persons;
    expect(person?.properties).toEqual({ plan: "pro", firstPlan: "free" });
  });

  it("doesn't rewrite someone seen again within a minute", async () => {
    const t = setup();
    const start = Date.now() - 10 * MINUTE;
    await send(t, [event({ timestamp: start })]);
    await send(t, [event({ timestamp: start + 30_000 })]);
    expect((await all(t)).persons[0]?.lastSeenAt).toBe(start);
    await send(t, [event({ timestamp: start + 2 * MINUTE })]);
    expect((await all(t)).persons[0]?.lastSeenAt).toBe(start + 2 * MINUTE);
  });
});

describe("identify", () => {
  const identify = (account: string, anonymous: string | null, extra: Partial<WireEvent> = {}) =>
    event({
      name: "$identify",
      distinctId: account,
      properties: anonymous ? { anonDistinctId: anonymous } : {},
      ...extra,
    });

  it("gives an anonymous visitor's person to the account they sign in to", async () => {
    const t = setup();
    await send(t, [event({ distinctId: "anon-1" })]);
    await send(t, [identify("user-1", "anon-1", { set: { username: "ifiok" } }), event({ distinctId: "user-1" })]);
    const { persons, distinctIds, sessions, events } = await all(t);
    expect(persons).toHaveLength(1);
    expect(persons[0]).toMatchObject({ identified: true, properties: { username: "ifiok" } });
    expect(distinctIds.map((row) => row.distinctId).sort()).toEqual(["anon-1", "user-1"]);
    expect(new Set(events.map((row) => row.personId))).toEqual(new Set([persons[0]?._id]));
    // The session is the account's from here on.
    expect(sessions[0]?.distinctId).toBe("user-1");
  });

  it("merges a browser's history into an account that already has one", async () => {
    vi.useFakeTimers();
    const t = setup();
    const earlier = Date.now() - DAY;
    // The account was used on another device first...
    await send(t, [identify("user-1", "phone"), event({ distinctId: "user-1", sessionId: "phone-session" })]);
    // ...and this browser browsed anonymously, earlier still, from a search.
    await send(t, [
      event({
        distinctId: "laptop",
        sessionId: "laptop-session",
        timestamp: earlier,
        properties: { referrer: "https://www.google.com/" },
      }),
      event({ distinctId: "laptop", sessionId: "laptop-session", timestamp: earlier + MINUTE, set: { theme: "dark" } }),
    ]);
    await send(t, [identify("user-1", "laptop", { sessionId: "laptop-session" })]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const { persons, distinctIds, sessions, events } = await all(t);
    expect(persons).toHaveLength(1);
    const [person] = persons;
    expect(person).toMatchObject({
      identified: true,
      createdAt: earlier,
      initialSource: { channel: "search", referrerDomain: "google.com" },
      properties: { theme: "dark" },
    });
    expect(person?.mergedInto).toBeUndefined();
    expect(distinctIds.map((row) => row.distinctId).sort()).toEqual(["laptop", "phone", "user-1"]);
    expect(distinctIds.every((row) => row.personId === person?._id)).toBe(true);
    expect(sessions.every((row) => row.personId === person?._id)).toBe(true);
    expect(events.every((row) => row.personId === person?._id)).toBe(true);
  });

  it("moves a long history in pages", async () => {
    vi.useFakeTimers();
    const t = setup();
    await send(t, [identify("user-1", null)]);
    const start = Date.now() - DAY;
    for (let page = 0; page < 5; page += 1) {
      await send(
        t,
        Array.from({ length: 100 }, (_, n) =>
          event({ distinctId: "browser", sessionId: `s${page}`, timestamp: start + page * 100 + n }),
        ),
      );
    }
    await send(t, [identify("user-1", "browser")]);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { persons, events } = await all(t);
    expect(persons).toHaveLength(1);
    expect(events).toHaveLength(502);
    expect(events.every((row) => row.personId === persons[0]?._id)).toBe(true);
  });

  it("never merges two accounts that shared a browser", async () => {
    vi.useFakeTimers();
    const t = setup();
    await send(t, [event({ distinctId: "shared" }), identify("alice", "shared")], "alice");
    // Bob signs in on the same browser without it being reset.
    await send(
      t,
      [identify("bob", "alice", { sessionId: "bob-session" }), event({ distinctId: "bob", sessionId: "bob-session" })],
      "bob",
    );
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { persons, distinctIds } = await all(t);
    expect(persons).toHaveLength(2);
    const owner = (distinctId: string) => distinctIds.find((row) => row.distinctId === distinctId)?.personId;
    expect(owner("alice")).toBe(owner("shared"));
    expect(owner("bob")).not.toBe(owner("alice"));
    expect(persons.every((person) => person.identified)).toBe(true);
  });

  it("keeps an account's person when it was seen elsewhere and the browser's id is new", async () => {
    const t = setup();
    await send(t, [identify("user-1", null)]);
    await send(t, [identify("user-1", "fresh-browser")]);
    const { persons, distinctIds } = await all(t);
    expect(persons).toHaveLength(1);
    expect(distinctIds.map((row) => row.distinctId).sort()).toEqual(["fresh-browser", "user-1"]);
  });

  it("makes one identified person when neither id was seen before", async () => {
    const t = setup();
    await send(t, [identify("user-1", "anon-9")]);
    const { persons, distinctIds } = await all(t);
    expect(persons).toEqual([expect.objectContaining({ identified: true })]);
    expect(distinctIds).toHaveLength(2);
  });
});

describe("capture from server code", () => {
  it("records an event with no session, as an identified person", async () => {
    const t = setup();
    const result = await t.mutation(api.ingest.capture, {
      name: "slop launched",
      distinctId: "user-1",
      properties: { category: "games", "not ok": 1 },
      set: { username: "ifiok" },
      identified: true,
    });
    expect(result).toEqual({ stored: 1, duplicates: 0, throttled: 0 });
    const { persons, sessions, events } = await all(t);
    expect(sessions).toHaveLength(0);
    expect(events[0]).toMatchObject({ name: "slop launched", sessionId: null, properties: { category: "games" } });
    expect(persons[0]).toMatchObject({ identified: true, properties: { username: "ifiok" } });
  });

  it("joins the person the browser identified, so both histories are one", async () => {
    const t = setup();
    await send(t, [
      event({ distinctId: "anon" }),
      event({ name: "$identify", distinctId: "user-1", properties: { anonDistinctId: "anon" } }),
    ]);
    await t.mutation(api.ingest.capture, { name: "voted", distinctId: "user-1", identified: true });
    const { persons, events } = await all(t);
    expect(persons).toHaveLength(1);
    expect(events.map((row) => row.name)).toContain("voted");
  });
});

describe("persons", () => {
  it("finds a person by any of their ids", async () => {
    const t = setup();
    await send(t, [
      event({ distinctId: "anon" }),
      event({ name: "$identify", distinctId: "user-1", properties: { anonDistinctId: "anon" } }),
    ]);
    const person = await t.query(api.persons.get, { distinctId: "anon" });
    expect(person?.distinctIds.sort()).toEqual(["anon", "user-1"]);
    expect(await t.query(api.persons.get, { distinctId: "nobody" })).toBeNull();
  });

  it("forgets everything about a person", async () => {
    vi.useFakeTimers();
    const t = setup();
    await send(
      t,
      Array.from({ length: 250 }, () => event({ distinctId: "leaving" })),
    );
    await send(t, [event({ distinctId: "staying", sessionId: "other" })]);
    expect(await t.mutation(api.persons.forget, { distinctId: "leaving" })).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { persons, distinctIds, sessions, events } = await all(t);
    expect(distinctIds.map((row) => row.distinctId)).toEqual(["staying"]);
    expect(persons).toHaveLength(1);
    expect(sessions.map((row) => row.sessionId)).toEqual(["other"]);
    expect(events).toHaveLength(1);
    expect(await t.mutation(api.persons.forget, { distinctId: "leaving" })).toBe(false);
  });
});

describe("maintenance", () => {
  it("deletes events, sessions and people past their retention", async () => {
    vi.useFakeTimers();
    const t = setup();
    const old = Date.now() - 40 * DAY;
    await send(t, [event({ distinctId: "gone", sessionId: "old", timestamp: old })]);
    await send(t, [event({ distinctId: "kept", sessionId: "older-but-active", timestamp: old })]);
    await send(t, [event({ distinctId: "kept", sessionId: "new" })]);
    const result = await t.mutation(api.maintenance.sweep, { retention: { eventDays: 30, personDays: 30 } });
    // Two old events, their two sessions, the person seen only then, and the old day's rollup marker.
    expect(result).toEqual({ deleted: 6, more: false });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { persons, distinctIds, sessions, events } = await all(t);
    expect(sessions.map((row) => row.sessionId)).toEqual(["new"]);
    expect(events).toHaveLength(1);
    expect(distinctIds.map((row) => row.distinctId)).toEqual(["kept"]);
    expect(persons).toHaveLength(1);
  });

  it("keeps going in the background when there's more than a page to delete", async () => {
    vi.useFakeTimers();
    const t = setup();
    const old = Date.now() - 40 * DAY;
    for (let page = 0; page < 6; page += 1) {
      await send(
        t,
        Array.from({ length: 100 }, (_, n) => event({ timestamp: old + page * 100 + n })),
      );
    }
    const result = await t.mutation(api.maintenance.sweep, { retention: { eventDays: 30, personDays: 60 } });
    expect(result.more).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const { events, persons } = await all(t);
    expect(events).toHaveLength(0);
    // Seen 40 days ago: past the events' retention, not the person's.
    expect(persons).toHaveLength(1);
  });

  it("refuses a retention that would orphan events", async () => {
    const t = setup();
    await expect(t.mutation(api.maintenance.sweep, { retention: { eventDays: 30, personDays: 7 } })).rejects.toThrow(
      "at least as long",
    );
  });
});

describe("events.recent", () => {
  it("lists the latest events, everyone's, one event's or one person's", async () => {
    const t = setup();
    const start = Date.now() - 10 * MINUTE;
    await send(t, [
      event({ distinctId: "anon", timestamp: start }),
      event({ distinctId: "anon", name: "$autocapture", timestamp: start + 1 }),
      event({ name: "$identify", distinctId: "user-1", properties: { anonDistinctId: "anon" }, timestamp: start + 2 }),
      event({ distinctId: "someone-else", sessionId: "other", timestamp: start + 3 }),
    ]);
    const names = (rows: { name: string }[]) => rows.map((row) => row.name);
    expect(names(await t.query(api.events.recent, { limit: 2 }))).toEqual(["$pageview", "$identify"]);
    expect((await t.query(api.events.recent, { name: "$pageview" })).map((row) => row.distinctId)).toEqual([
      "someone-else",
      "anon",
    ]);
    // Any of the person's ids finds all of their events.
    expect(names(await t.query(api.events.recent, { distinctId: "user-1" }))).toEqual([
      "$identify",
      "$autocapture",
      "$pageview",
    ]);
    expect(names(await t.query(api.events.recent, { distinctId: "anon", name: "$autocapture" }))).toEqual([
      "$autocapture",
    ]);
    expect(await t.query(api.events.recent, { distinctId: "nobody" })).toEqual([]);
  });
});

describe("groups", () => {
  it("keeps what an event is about, and reads by it", async () => {
    const t = setup();
    const start = Date.now() - 10 * MINUTE;
    await send(t, [
      event({ group: "slop:a", timestamp: start }),
      event({ group: "slop:a", name: "$autocapture", timestamp: start + 1 }),
      event({ group: "slop:b", timestamp: start + 2 }),
      event({ timestamp: start + 3 }),
    ]);
    await t.mutation(api.ingest.capture, {
      name: "voted",
      distinctId: "user-1",
      group: "slop:a",
      timestamp: start + 4,
    });
    const about = await t.query(api.events.recent, { group: "slop:a" });
    expect(about.map((row) => row.name)).toEqual(["voted", "$autocapture", "$pageview"]);
    expect(await t.query(api.events.recent, { group: "slop:a", name: "voted" })).toHaveLength(1);
    const page = await t.query(api.scan.events, {
      name: "$pageview",
      group: "slop:a",
      from: start,
      to: start + MINUTE,
      cursor: null,
      numItems: 10,
    });
    expect(page.page.map((row) => [row.name, row.group])).toEqual([["$pageview", "slop:a"]]);
    // Every event is read name by name: the names seen in the range, and none from before it.
    expect((await t.query(api.scan.eventNames, { from: start, to: start + MINUTE })).sort()).toEqual([
      "$autocapture",
      "$pageview",
      "voted",
    ]);
    expect(await t.query(api.scan.eventNames, { from: start + 2 * 3_600_000, to: start + 3 * 3_600_000 })).toEqual([]);
    await expect(
      t.query(api.scan.events, { name: null, from: start, to: start + MINUTE, cursor: null, numItems: 10 }),
    ).rejects.toThrow("name by name");
  });

  it("looks up where sessions came from, skipping ones that are gone", async () => {
    const t = setup();
    await send(t, [event({ sessionId: "s1", properties: { referrer: "https://t.co/x", country: "US" } })]);
    expect(await t.query(api.scan.sessionSources, { sessionIds: ["s1", "missing"] })).toEqual([
      {
        sessionId: "s1",
        country: "US",
        source: { referrerDomain: "t.co", utmSource: null, utmMedium: null, utmCampaign: null, channel: "social" },
      },
    ]);
  });
});

describe("paging", () => {
  it("pages through events sharing a timestamp without losing or repeating any", async () => {
    const t = setup();
    const at = Date.now() - MINUTE;
    // 25 events at the same moment, then 5 a millisecond later: pages of 10 split the run.
    await send(t, [
      ...Array.from({ length: 25 }, (_, n) => event({ uuid: `same-${n}`, timestamp: at })),
      ...Array.from({ length: 5 }, (_, n) => event({ uuid: `later-${n}`, timestamp: at + 1 })),
    ]);
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const result: { page: { timestamp: number }[]; isDone: boolean; continueCursor: string } = await t.query(
        api.scan.events,
        { name: "$pageview", from: at, to: at + MINUTE, cursor, numItems: 10 },
      );
      seen.push(...result.page.map((row) => String(row.timestamp)));
      if (result.isDone) break;
      cursor = result.continueCursor;
    }
    expect(seen).toHaveLength(30);
    expect(seen.filter((timestamp) => timestamp === String(at))).toHaveLength(25);
  });

  it("lists people most recently seen first, page by page", async () => {
    const t = setup();
    const base = Date.now() - 10 * MINUTE;
    for (let n = 0; n < 7; n += 1) {
      await send(t, [event({ distinctId: `person-${n}`, sessionId: `s-${n}`, timestamp: base + n * MINUTE })]);
    }
    const first = await t.query(api.persons.list, { cursor: null, numItems: 4 });
    const second = await t.query(api.persons.list, { cursor: first.continueCursor, numItems: 4 });
    expect(first.isDone).toBe(false);
    expect(second.isDone).toBe(true);
    expect([...first.page, ...second.page].map((person) => person.distinctIds[0])).toEqual([
      "person-6",
      "person-5",
      "person-4",
      "person-3",
      "person-2",
      "person-1",
      "person-0",
    ]);
  });
});
