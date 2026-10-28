// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "../src/component/_generated/api";
import schema from "../src/component/schema";
import { REPLAY_LIMITS } from "../src/shared/replay";

/** Session recordings as the component keeps them: chunks in file storage, a row per session. */

const modules = import.meta.glob("../src/component/**/*.ts");
const DAY = 86_400_000;
const CONTEXT = {
  device: { browser: "Chrome", browserVersion: "141", os: "macOS", osVersion: "10", deviceType: "desktop" as const },
  ownHost: "slopper.day",
};

function setup() {
  return convexTest(schema, modules);
}

type Test = ReturnType<typeof setup>;

function bytes(text: string): ArrayBuffer {
  return new TextEncoder().encode(text).buffer;
}

async function store(
  t: Test,
  overrides: { sessionId?: string; distinctId?: string; accountId?: string; at?: number; data?: string } = {},
) {
  const at = overrides.at ?? Date.now();
  return await t.action(api.recordings.store, {
    sessionId: overrides.sessionId ?? "session-1",
    distinctId: overrides.distinctId ?? "visitor-1",
    accountId: overrides.accountId,
    startedAt: at,
    endedAt: at + 4_000,
    events: 3,
    encoding: "identity",
    data: bytes(overrides.data ?? JSON.stringify([{ type: 4, timestamp: at }])),
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("recordings", () => {
  it("keeps a recording's owner even when its session row has not arrived", async () => {
    const t = setup();
    expect(await store(t)).toBe(true);
    expect(await store(t, { distinctId: "other-visitor" })).toBe(false);
    const found = await t.query(api.recordings.get, { sessionId: "session-1" });
    expect(found?.recording.chunks).toBe(1);
    expect(await t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length)).toBe(1);
  });

  it("rechecks account ownership when a chunk is committed after sign-in", async () => {
    const t = setup();
    const now = Date.now();
    expect(await store(t)).toBe(true);
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob(["[]"])));
    await t.mutation(api.ingest.batch, {
      accountId: "user-1",
      context: CONTEXT,
      events: [
        {
          uuid: "sign-in",
          name: "$identify",
          distinctId: "user-1",
          sessionId: "session-1",
          timestamp: now,
          path: "/",
          properties: { anonDistinctId: "visitor-1" },
          set: null,
          setOnce: null,
          group: null,
        },
      ],
    });
    await t.mutation(internal.recordings.addChunk, {
      sessionId: "session-1",
      distinctId: "visitor-1",
      startedAt: now,
      endedAt: now,
      events: 1,
      encoding: "identity",
      storageId,
      bytes: 2,
    });
    expect((await t.query(api.recordings.get, { sessionId: "session-1" }))?.recording.chunks).toBe(1);
    expect(await store(t, { distinctId: "user-1", accountId: "user-1" })).toBe(true);
    expect(await store(t, { distinctId: "user-1" })).toBe(false);
    const found = await t.query(api.recordings.get, { sessionId: "session-1" });
    expect(found?.recording.chunks).toBe(2);
    expect(await t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length)).toBe(2);
  });

  it("keeps chunks and adds up their session's recording", async () => {
    const t = setup();
    const at = Date.now() - 60_000;
    expect(await store(t, { at })).toBe(true);
    expect(await store(t, { at: at + 10_000, data: "[1,2]" })).toBe(true);
    const found = await t.query(api.recordings.get, { sessionId: "session-1" });
    expect(found?.recording).toMatchObject({
      sessionId: "session-1",
      distinctId: "visitor-1",
      startedAt: at,
      endedAt: at + 14_000,
      chunks: 2,
      events: 6,
    });
    expect(found?.chunks.map((chunk) => chunk.startedAt)).toEqual([at, at + 10_000]);
    expect(found?.chunks.every((chunk) => chunk.url.length > 0 && chunk.encoding === "identity")).toBe(true);
    expect(await t.query(api.recordings.get, { sessionId: "nobody" })).toBeNull();
    expect(await t.query(api.recordings.recorded, { sessionIds: ["session-1", "other"] })).toEqual(["session-1"]);
  });

  it("refuses empty and oversized chunks, and stops a session at its limit", async () => {
    const t = setup();
    expect(await store(t, { data: "" })).toBe(false);
    const tooBig = "x".repeat(REPLAY_LIMITS.chunkBytes + 1);
    expect(await store(t, { data: tooBig })).toBe(false);
    await t.run(async (ctx) => {
      await ctx.db.insert("recordings", {
        sessionId: "full",
        distinctId: "visitor-1",
        startedAt: 1,
        endedAt: 2,
        chunks: 99,
        bytes: REPLAY_LIMITS.sessionBytes - 3,
        events: 1,
      });
    });
    // Three bytes left: five don't fit, three do, and then nothing more.
    expect(await store(t, { sessionId: "full", data: "[1,2]" })).toBe(false);
    expect(await store(t, { sessionId: "full", data: "[1]" })).toBe(true);
    expect(await store(t, { sessionId: "full", data: "[]" })).toBe(false);
  });

  it("lists recordings newest first, with their sessions", async () => {
    const t = setup();
    const now = Date.now();
    await t.mutation(api.ingest.batch, {
      events: [
        {
          uuid: "u1",
          name: "$pageview",
          distinctId: "visitor-1",
          sessionId: "older",
          timestamp: now - 5_000,
          path: "/wall",
          properties: {},
          set: null,
          setOnce: null,
          group: null,
        },
      ],
      context: CONTEXT,
    });
    await store(t, { sessionId: "older", at: now - 5_000 });
    await store(t, { sessionId: "newer", at: now - 1_000 });
    const first = await t.query(api.recordings.list, { cursor: null, numItems: 1 });
    expect(first.page.map(({ recording, session }) => [recording.sessionId, session?.entryPath ?? null])).toEqual([
      ["newer", null],
    ]);
    const second = await t.query(api.recordings.list, { cursor: first.continueCursor, numItems: 1 });
    expect(second.page.map(({ recording, session }) => [recording.sessionId, session?.entryPath])).toEqual([
      ["older", "/wall"],
    ]);
  });

  it("forgets what was recorded from a person, under any of their ids", async () => {
    vi.useFakeTimers();
    const t = setup();
    const now = Date.now();
    const pageview = (uuid: string, distinctId: string, extra: object = {}) => ({
      uuid,
      name: "$pageview",
      distinctId,
      sessionId: "s1",
      timestamp: now,
      path: "/",
      properties: {},
      set: null,
      setOnce: null,
      group: null,
      ...extra,
    });
    await t.mutation(api.ingest.batch, { events: [pageview("a", "visitor-1")], context: CONTEXT });
    await t.mutation(api.ingest.batch, {
      accountId: "user-1",
      events: [pageview("b", "user-1", { name: "$identify", properties: { anonDistinctId: "visitor-1" } })],
      context: CONTEXT,
    });
    expect(await store(t, { sessionId: "s1", distinctId: "visitor-1" })).toBe(false);
    expect(await store(t, { sessionId: "s1", distinctId: "user-1", accountId: "user-1" })).toBe(true);
    await store(t, { sessionId: "someone-else", distinctId: "visitor-2" });
    expect(await t.mutation(api.persons.forget, { distinctId: "user-1" })).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const left = await t.run(async (ctx) => ({
      recordings: (await ctx.db.query("recordings").collect()).map((row) => row.sessionId),
      chunks: (await ctx.db.query("recordingChunks").collect()).map((row) => row.distinctId),
      files: (await ctx.db.system.query("_storage").collect()).length,
    }));
    expect(left).toEqual({ recordings: ["someone-else"], chunks: ["visitor-2"], files: 1 });
  });

  it("are swept after 30 days unless the app keeps them longer", async () => {
    const t = setup();
    const now = Date.now();
    await store(t, { sessionId: "old", at: now - 31 * DAY });
    await store(t, { sessionId: "recent", at: now - 29 * DAY });
    await t.mutation(api.maintenance.sweep, { retention: { eventDays: 365, personDays: 365 } });
    expect(await t.query(api.recordings.recorded, { sessionIds: ["old", "recent"] })).toEqual(["recent"]);
    expect(await t.run(async (ctx) => (await ctx.db.system.query("_storage").collect()).length)).toBe(1);
    await t.mutation(api.maintenance.sweep, { retention: { eventDays: 365, personDays: 365, recordingDays: 90 } });
    expect(await t.query(api.recordings.recorded, { sessionIds: ["recent"] })).toEqual(["recent"]);
    await expect(
      t.mutation(api.maintenance.sweep, { retention: { eventDays: 365, personDays: 365, recordingDays: 0 } }),
    ).rejects.toThrow("Keep recordings for a day at least.");
  });
});
