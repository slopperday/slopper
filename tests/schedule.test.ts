// @vitest-environment edge-runtime
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convexApp } from "./convexApp";
import { applyCurrentCheck, checkedLaunch } from "./launchFixtures";

const APP = "https://app.test";

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

type Server = ReturnType<typeof setup>["server"];

async function makeUser(server: Server, name: string, timeZone = "UTC"): Promise<Id<"users">> {
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: name,
    preferredUsername: name,
    displayName: name,
    avatarUrl: null,
    timeZone,
  });
  return userId;
}

const input = (name: string) => ({
  name,
  tagline: "Ready now",
  description: "",
  category: "games",
  links: [{ kind: "website" as const, url: "https://example.com/" }],
  screenshots: [] as string[],
  madeWith: [],
});

function schedule(
  server: Server,
  userId: Id<"users">,
  name: string,
  when: { kind: "next" } | { kind: "at"; at: number },
) {
  return server.mutation(api.schedule.add, { userId, input: input(name), launchNote: "", when, autopost: true });
}

/** Records what Convex asks of the app server, answering with `status`. */
function stubApp(status = 204): string[] {
  const calls: string[] = [];
  vi.stubEnv("APP_URL", APP);
  vi.stubGlobal("fetch", async (request: RequestInfo | URL) => {
    calls.push(request instanceof Request ? request.url : request.toString());
    return new Response(null, { status });
  });
  return calls;
}

type Test = ReturnType<typeof setup>["t"];

/** Moves the clock to `iso` and runs what was due by then, each at its own time. */
async function advanceTo(t: Test, iso: string): Promise<void> {
  vi.advanceTimersByTime(Date.parse(iso) - Date.now());
  await t.finishInProgressScheduledFunctions();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("scheduled launches", () => {
  it("lines launches up one a day, keeps them private until they go out, then counts each on its day", async () => {
    const calls = stubApp();
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const fan = await makeUser(server, "fan");
    await server.mutation(api.goals.create, {
      userId: maker,
      title: "10 in 10",
      target: 10,
      days: 10,
      startDate: "2026-10-15",
      today: "2026-10-15",
    });
    await checkedLaunch(server, {
      userId: maker,
      input: input("Today"),
      launchNote: "",
    });
    const second = await schedule(server, maker, "Second", { kind: "next" });
    const third = await schedule(server, maker, "Third", { kind: "next" });
    // Each goes out as its day's race starts: the next free UTC midnights.
    expect(new Date(second.releaseAt).toISOString()).toBe("2026-10-16T00:00:00.000Z");
    expect(new Date(third.releaseAt).toISOString()).toBe("2026-10-17T00:00:00.000Z");

    // Only the maker sees them; the goal shows them as coming, not counted.
    expect((await server.query(api.schedule.mine, { asUser: maker })).map((item) => item.name)).toEqual([
      "Second",
      "Third",
    ]);
    expect(await server.query(api.schedule.mine, { asUser: fan })).toEqual([]);
    expect(await t.query(api.schedule.mine, {})).toEqual([]);
    const before = await server.query(api.users.profile, { username: "maker" });
    expect(before?.progress?.shipped).toBe(1);
    expect(before?.progress?.days.slice(0, 3).map((day) => day.queued)).toEqual([0, 1, 1]);
    expect(before?.items.map((item) => item.slop.name)).toEqual(["Today"]);
    expect((await server.query(api.race.day, { date: "2026-10-16" })).items).toEqual([]);

    await advanceTo(t, "2026-10-16T00:00:00Z");
    await advanceTo(t, "2026-10-17T00:00:00Z");
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const slops = await server.query(api.slops.listForServer, { userId: maker });
    expect((await server.query(api.race.day, { date: "2026-10-16" })).items).toEqual([]);
    for (const slop of slops) {
      await applyCurrentCheck(server, { slopId: slop._id, scope: "slop", verdict: "ok", reason: "Fixture" });
    }
    const after = await server.query(api.users.profile, { username: "maker" });
    expect(after?.progress?.shipped).toBe(3);
    expect(after?.progress?.days.slice(0, 3).map((day) => [day.state, day.queued])).toEqual([
      ["shipped", 0],
      ["shipped", 0],
      ["shipped", 0],
    ]);
    expect(slops.map((slop) => [slop.name, slop.launchDate, slop.raceDate, slop.goalDay, slop.number])).toEqual([
      ["Third", "2026-10-17", "2026-10-17", 3, 3],
      ["Second", "2026-10-16", "2026-10-16", 2, 2],
      ["Today", "2026-10-15", "2026-10-15", 1, 1],
    ]);
    expect((await server.query(api.race.day, { date: "2026-10-16" })).items.map((item) => item.slop.name)).toEqual([
      "Second",
    ]);

    // Convex asked the app server to finish each one; until it claims them they show as out.
    expect(calls.sort()).toEqual([`${APP}/api/scheduled/${second.id}`, `${APP}/api/scheduled/${third.id}`].sort());
    const out = await server.query(api.schedule.mine, { asUser: maker });
    expect(out.map((item) => item.out?.slug)).toEqual(["second", "third"]);

    // A release is handed out once, and only to its owner when one is named.
    expect(await server.mutation(api.schedule.claim, { id: second.id, userId: fan })).toBeNull();
    const claimed = await server.mutation(api.schedule.claim, { id: second.id });
    expect(claimed).toMatchObject({ userId: maker, name: "Second", autopost: true, launchNote: "" });
    expect(claimed?.slopId).toBe(slops[1]._id);
    expect(await server.mutation(api.schedule.claim, { id: second.id })).toBeNull();
    expect(await server.mutation(api.schedule.claim, { id: "not-an-id" })).toBeNull();
  });

  it("puts a launch out at a picked time on that moment's UTC day", async () => {
    stubApp();
    const { t, server } = setup();
    const maker = await makeUser(server, "maker", "America/Los_Angeles");
    // 11pm in Los Angeles on the 15th is already the 16th in UTC, the day it counts for.
    const at = Date.parse("2026-10-16T06:00:00Z");
    await schedule(server, maker, "Late", { kind: "at", at });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [slop] = await server.query(api.slops.listForServer, { userId: maker });
    expect([slop.launchDate, slop.raceDate]).toEqual(["2026-10-16", "2026-10-16"]);
    expect(Math.floor(slop._creationTime)).toBe(at);
  });

  it("keeps the product page it was scheduled with when it goes out", async () => {
    stubApp();
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const page = {
      demo: { provider: "youtube" as const, id: "dQw4w9WgXcQ", vertical: false },
      features: [{ title: "Tilt to roll", body: "The tilt is the only control." }],
      audience: "Anyone with a spare thumb",
    };
    await server.mutation(api.schedule.add, {
      userId: maker,
      input: { ...input("Marble Run"), ...page },
      launchNote: "",
      when: { kind: "at", at: Date.parse("2026-10-16T09:00:00Z") },
      autopost: false,
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const [slop] = await server.query(api.slops.listForServer, { userId: maker });
    expect({ demo: slop.demo, features: slop.features, audience: slop.audience }).toEqual(page);
  });

  it("tries the app server three times, a minute apart and more, then leaves it to the maker", async () => {
    const calls = stubApp(503);
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const { id } = await schedule(server, maker, "Flaky", { kind: "next" });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(calls).toEqual([1, 2, 3].map(() => `${APP}/api/scheduled/${id}`));
    expect((await server.query(api.schedule.mine, { asUser: maker }))[0].out).toEqual({ slug: "flaky" });
  });

  it("goes out now on request, or is dropped, and the timer then finds nothing to do", async () => {
    const calls = stubApp();
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const fan = await makeUser(server, "fan");
    const now = await schedule(server, maker, "Now", { kind: "next" });
    const dropped = await schedule(server, maker, "Dropped", { kind: "next" });

    await expect(server.mutation(api.schedule.releaseNow, { userId: fan, id: now.id })).rejects.toThrow(
      "That scheduled launch isn't yours.",
    );
    const out = await server.mutation(api.schedule.releaseNow, { userId: maker, id: now.id });
    expect(out).toMatchObject({ slug: "now", name: "Now", autopost: true });
    await applyCurrentCheck(server, { slopId: out.slopId, scope: "slop", verdict: "ok", reason: "Fixture" });
    await server.mutation(api.schedule.complete, { id: now.id, claimVersion: out.claimVersion, checked: true });
    await expect(server.mutation(api.schedule.cancel, { userId: fan, id: dropped.id })).rejects.toThrow(
      "That scheduled launch isn't yours.",
    );
    expect(await server.mutation(api.schedule.cancel, { userId: maker, id: dropped.id })).toEqual({
      name: "Dropped",
      orphaned: 0,
    });

    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const slops = await server.query(api.slops.listForServer, { userId: maker });
    expect(slops.map((slop) => [slop.name, slop.launchDate])).toEqual([["Now", "2026-10-15"]]);
    expect(await server.query(api.schedule.mine, { asUser: maker })).toEqual([]);
    expect(calls).toEqual([]);
  });

  it("refuses times in the past or too far ahead", async () => {
    const { server } = setup();
    const maker = await makeUser(server, "maker");
    await expect(schedule(server, maker, "Late", { kind: "at", at: Date.now() - 1 })).rejects.toThrow(
      "Pick a time that hasn't happened yet.",
    );
    await expect(schedule(server, maker, "Far", { kind: "at", at: Date.now() + 101 * 86_400_000 })).rejects.toThrow(
      "Pick a time in the next 100 days.",
    );
  });

  it("keeps a product with launches scheduled, and lets go of a dropped launch's screenshots", async () => {
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const first = await checkedLaunch(server, {
      userId: maker,
      input: input("Marbles"),
      launchNote: "",
    });
    const shot = await t.run((ctx) =>
      ctx.db.insert("media", { ownerId: maker, contentType: "image/png", size: 1, backend: "b2", key: "a.png" }),
    );
    const ios = await server.mutation(api.schedule.add, {
      userId: maker,
      input: { ...input("Marbles"), screenshots: [shot] },
      launchNote: "",
      when: { kind: "next" },
      autopost: false,
      relaunchOf: first.slopId,
      launchLabel: "iOS app",
    });
    await expect(server.mutation(api.slops.remove, { slopId: first.slopId, byUserId: maker })).rejects.toThrow(
      "Cancel this product's scheduled launches first.",
    );

    expect(await server.mutation(api.schedule.cancel, { userId: maker, id: ios.id })).toEqual({
      name: "Marbles",
      orphaned: 1,
    });
    expect((await t.run((ctx) => ctx.db.get(shot)))?.orphanedAt).toBeTypeOf("number");
    expect(await server.mutation(api.slops.remove, { slopId: first.slopId, byUserId: maker })).toEqual({
      orphaned: 0,
    });
  });

  it("launches another platform of a product when its time comes", async () => {
    stubApp();
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const first = await checkedLaunch(server, {
      userId: maker,
      input: input("Marbles"),
      launchNote: "",
    });
    await server.mutation(api.schedule.add, {
      userId: maker,
      input: input("Marbles"),
      launchNote: "",
      when: { kind: "next" },
      autopost: false,
      relaunchOf: first.slopId,
      launchLabel: "iOS app",
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const slops = await server.query(api.slops.listForServer, { userId: maker });
    for (const slop of slops) {
      await applyCurrentCheck(server, { slopId: slop._id, scope: "slop", verdict: "ok", reason: "Fixture" });
    }
    const page = await server.query(api.slops.page, { username: "maker", slug: "marbles" });
    expect(page?.launches.map((launch) => [launch.title, launch.launchDate])).toEqual([
      ["First launch", "2026-10-15"],
      ["iOS app", "2026-10-16"],
    ]);
  });
});
