// @vitest-environment edge-runtime
import process from "node:process";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, components } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { analyticsOptedOut, analyticsSetup, countryOf } from "~/.server/analytics";
import { loadConfig } from "~/.server/config";
import { mayRecordPath, sanitizeAnalyticsPath } from "~/lib/analytics";
import { convexApp } from "./convexApp";

// convex/http.ts allows browsers from APP_URL, as on the real deployment.
process.env.APP_URL = "https://slopper.day";

const CHROME =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";

afterEach(() => {
  vi.useRealTimers();
});

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

type Server = ReturnType<typeof setup>["server"];

async function makeUser(server: Server, name: string): Promise<Id<"users">> {
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "github",
    providerId: name,
    preferredUsername: name,
    displayName: name,
    avatarUrl: null,
    timeZone: "UTC",
  });
  return userId;
}

function batch(events: Record<string, unknown>[]) {
  return JSON.stringify({
    sentAt: Date.now(),
    events: events.map((event, index) => ({
      uuid: `uuid-${index}-${Math.random()}`,
      name: "$pageview",
      distinctId: "visitor",
      sessionId: "session",
      timestamp: Date.now(),
      path: "/",
      properties: {},
      ...event,
    })),
  });
}

describe("analytics config", () => {
  it("sends to a cloud deployment's .convex.site URL", () => {
    expect(loadConfig({ CONVEX_URL: "https://cheerful-goshawk-318.convex.cloud" }).analyticsEndpoint).toBe(
      "https://cheerful-goshawk-318.convex.site/a",
    );
  });

  it("takes a site URL as given, for self-hosted backends", () => {
    const config = loadConfig({ CONVEX_URL: "http://127.0.0.1:3210", CONVEX_SITE_URL: "http://127.0.0.1:3211/" });
    expect(config.analyticsEndpoint).toBe("http://127.0.0.1:3211/a");
  });

  it("is off when there's nowhere to send", () => {
    expect(loadConfig({}).analyticsEndpoint).toBeNull();
    expect(loadConfig({ CONVEX_URL: "http://127.0.0.1:3210" }).analyticsEndpoint).toBeNull();
    expect(() => loadConfig({ CONVEX_SITE_URL: "nope" })).toThrow("CONVEX_SITE_URL isn't a URL");
  });

  it("records every session unless told a share", () => {
    expect(loadConfig({}).analyticsReplayRate).toBe(1);
    expect(loadConfig({ ANALYTICS_REPLAY_RATE: "0.25" }).analyticsReplayRate).toBe(0.25);
    expect(loadConfig({ ANALYTICS_REPLAY_RATE: "0" }).analyticsReplayRate).toBe(0);
    for (const value of ["1.5", "-1", "half"]) {
      expect(() => loadConfig({ ANALYTICS_REPLAY_RATE: value })).toThrow("ANALYTICS_REPLAY_RATE is a share");
    }
  });
});

describe("analytics on the app server", () => {
  const request = (headers: Record<string, string>) => new Request("https://slopper.day/", { headers });

  it("reads the visitor's country from Netlify's geolocation", () => {
    const geo = btoa(JSON.stringify({ city: "London", country: { code: "GB", name: "United Kingdom" } }));
    expect(countryOf(request({ "x-nf-geo": geo }))).toBe("GB");
    expect(countryOf(request({ "x-country": "de" }))).toBe("DE");
    expect(countryOf(request({ "x-nf-geo": "not base64 json", "x-country": "FR" }))).toBe("FR");
    expect(countryOf(request({ "x-country": "Narnia" }))).toBeNull();
    expect(countryOf(request({}))).toBeNull();
  });

  it("tells the SDK where to send and what it can't know", () => {
    expect(analyticsSetup(request({ "x-country": "GB" }))).toBeNull();
    expect(analyticsOptedOut(request({ cookie: "sa_off=1; slopper_tz=UTC" }))).toBe(true);
    expect(analyticsOptedOut(request({ cookie: "sa_id=abc" }))).toBe(false);
  });

  it("hides unsubscribe tokens in paths", () => {
    expect(sanitizeAnalyticsPath("/unsubscribe/abc123")).toBe("/unsubscribe/:token");
    expect(sanitizeAnalyticsPath("/@ifiok/tiltmaze")).toBe("/@ifiok/tiltmaze");
  });

  it("never records private pages for replay", () => {
    for (const path of ["/", "/wall", "/@ifiok/tiltmaze", "/new", "/goal", "/analyticsfans"]) {
      expect(mayRecordPath(path), path).toBe(true);
    }
    for (const path of [
      "/settings",
      "/settings/api",
      "/cli",
      "/notifications",
      "/mod/team",
      "/analytics",
      "/analytics/sessions/abc",
      "/@ifiok/tiltmaze/analytics",
    ]) {
      expect(mayRecordPath(path), path).toBe(false);
    }
  });
});

describe("the analytics endpoint", () => {
  const post = (body: string, headers: Record<string, string> = {}) => ({
    method: "POST",
    body,
    headers: { origin: "https://slopper.day", "user-agent": CHROME, "content-type": "text/plain", ...headers },
  });

  it("stores a browser's batch, with what the request says about the device", async () => {
    const { t } = setup();
    const response = await t.fetch(
      "/a/e",
      post(batch([{ properties: { referrer: "https://www.google.com/", country: "GB" } }])),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://slopper.day");
    expect(await response.json()).toEqual({ stored: 1, duplicates: 0, dropped: 0, throttled: 0 });
    const [event] = await t.query(components.analytics.events.recent, { distinctId: "visitor" });
    expect(event).toMatchObject({ name: "$pageview", path: "/" });
    const person = await t.query(components.analytics.persons.get, { distinctId: "visitor" });
    expect(person?.initialSource).toMatchObject({ channel: "search", referrerDomain: "google.com" });
  });

  it("answers a preflight for the site, and nobody else", async () => {
    const { t } = setup();
    const preflight = await t.fetch("/a/e", { method: "OPTIONS", headers: { origin: "https://slopper.day" } });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-methods")).toBe("POST");
    const elsewhere = await t.fetch("/a/e", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
    expect(elsewhere.status).toBe(403);
    const posted = await t.fetch("/a/e", post(batch([{}]), { origin: "https://evil.example" }));
    expect(posted.status).toBe(403);
    expect(await t.query(components.analytics.events.recent, {})).toEqual([]);
  });

  it("throttles a flood rather than storing all of it", async () => {
    // The endpoint is public, so a distinct id's day ceiling (lib/limits.ts)
    // is what a flood hits: batches past it keep nothing.
    const { t } = setup();
    vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
    const flood = () => t.fetch("/a/e", post(batch(Array.from({ length: 100 }, () => ({ distinctId: "flood" })))));
    for (let i = 0; i < 20; i++) await flood();
    const over = await flood();
    expect(over.status).toBe(200);
    expect(await over.json()).toMatchObject({ stored: 0, throttled: 100 });
  });

  it("drops crawlers without telling them", async () => {
    const { t } = setup();
    const response = await t.fetch("/a/e", post(batch([{}]), { "user-agent": "Googlebot/2.1" }));
    expect(response.ok).toBe(true);
    expect(await t.query(components.analytics.events.recent, {})).toEqual([]);
  });

  it("refuses what isn't a batch, or is too big to be one", async () => {
    const { t } = setup();
    expect((await t.fetch("/a/e", post("{not json"))).status).toBe(400);
    expect((await t.fetch("/a/e", post("x".repeat(600 * 1024)))).status).toBe(413);
    const empty = await t.fetch("/a/e", post(JSON.stringify({ events: [{ name: "no id" }] })));
    expect(await empty.json()).toEqual({ stored: 0, dropped: 1 });
  });
});

describe("product events", () => {
  it("records sign-ups, votes and pledges as the signed-in person", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "maker");
    const fan = await makeUser(server, "fan");
    const { slopId } = await server.mutation(api.slops.create, {
      userId: owner,
      input: {
        name: "TiltMaze",
        tagline: "Tilt to play",
        description: "A maze.",
        category: "games",
        links: [],
        screenshots: [],
        madeWith: [],
      },
      launchNote: "Day 1",
    });
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });
    await server.mutation(api.slops.pledge, { userId: fan, slopId, amount: 500 });

    const names = async (userId: Id<"users">) =>
      (await t.query(components.analytics.events.recent, { distinctId: userId })).map((event) => event.name);
    expect(await names(owner)).toEqual(["slop launched", "signed up"]);
    expect(await names(fan)).toEqual(["pledged", "upvoted", "signed up"]);

    const [signedUp] = await t.query(components.analytics.events.recent, { distinctId: owner, name: "signed up" });
    expect(signedUp?.properties).toEqual({ provider: "github" });
    const [launched] = await t.query(components.analytics.events.recent, { distinctId: owner, name: "slop launched" });
    expect(launched?.properties).toEqual({ category: "games", relaunch: false, goalDay: null });
    // Who pledged what stays private, in analytics too.
    const [pledged] = await t.query(components.analytics.events.recent, { distinctId: fan, name: "pledged" });
    expect(pledged?.properties).toEqual({});
    expect((await t.query(components.analytics.persons.get, { distinctId: fan }))?.identified).toBe(true);
  });

  it("joins what a visitor did before signing up to their account", async () => {
    vi.useFakeTimers();
    const { t, server } = setup();
    await t.fetch("/a/e", {
      method: "POST",
      body: batch([{ distinctId: "browser-1", path: "/wall" }]),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
    const userId = await makeUser(server, "newbie");
    await t.fetch("/a/e", {
      method: "POST",
      body: batch([{ name: "$identify", distinctId: userId, properties: { anonDistinctId: "browser-1" } }]),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
    // Signing up made the account's person first, so the browser's history merges into it.
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    const events = await t.query(components.analytics.events.recent, { distinctId: "browser-1" });
    expect(events.map((event) => event.name)).toEqual(["$identify", "signed up", "$pageview"]);
  });
});

describe("analytics for admins", () => {
  async function admin(t: ReturnType<typeof setup>["t"], server: Server, name = "boss"): Promise<Id<"users">> {
    const userId = await makeUser(server, name);
    await t.run(async (ctx) => await ctx.db.patch(userId, { role: "admin" }));
    return userId;
  }

  async function visit(t: ReturnType<typeof setup>["t"], distinctId: string, events: Record<string, unknown>[]) {
    await t.fetch("/a/e", {
      method: "POST",
      body: batch(events.map((event) => ({ distinctId, ...event }))),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
  }

  it("answers insights for admins and nobody else", async () => {
    const { t, server } = setup();
    const boss = await admin(t, server);
    const moderator = await makeUser(server, "mod");
    await t.run(async (ctx) => await ctx.db.patch(moderator, { role: "moderator" }));
    const now = Date.now();
    await visit(t, "a", [
      { sessionId: "a1", timestamp: now - 3_000 },
      { sessionId: "a1", path: "/wall", timestamp: now - 2_000 },
    ]);
    await visit(t, "b", [{ sessionId: "b1", timestamp: now - 1_000 }]);
    const query = {
      kind: "trends" as const,
      range: { from: now - 86_400_000, to: now + 1 },
      interval: "day" as const,
      series: [{ event: "$pageview", math: "persons" as const }],
    };
    const answer = await server.action(api.analytics.insight, { adminId: boss, query });
    expect(answer.truncated).toBe(false);
    expect(answer.result.kind).toBe("trends");
    if (answer.result.kind === "trends") expect(answer.result.series[0]?.total).toBe(2);

    const web = await server.action(api.analytics.insight, {
      adminId: boss,
      query: { kind: "web", range: query.range, interval: "day" },
    });
    if (web.result.kind !== "web") throw new Error("expected web analytics");
    expect(web.result.totals).toMatchObject({ visitors: 2, sessions: 2, pageviews: 3 });

    await expect(server.action(api.analytics.insight, { adminId: moderator, query })).rejects.toThrow(
      "Only admins can do that.",
    );
    await expect(t.action(api.analytics.insight, { adminId: boss, query })).rejects.toThrow("Only the Slopper server");
    await expect(
      server.action(api.analytics.insight, { adminId: boss, query: { ...query, range: { from: now, to: now - 1 } } }),
    ).rejects.toThrow("A range ends after it starts.");
  });

  it("counts people, accounts and who's been active", async () => {
    const { t, server } = setup();
    const boss = await admin(t, server);
    await visit(t, "visitor", [{}]);
    const counts = await server.action(api.analytics.overview, { adminId: boss });
    // The admin signed up (a person, identified, through the server) and a visitor browsed.
    expect(counts).toMatchObject({ accounts: 1, people: 2, identified: 1, activeToday: 2, newThisWeek: 2 });
  });

  it("lists people with their usernames, finds them by username, and shows one", async () => {
    const { t, server } = setup();
    const boss = await admin(t, server);
    const maker = await makeUser(server, "maker");
    await visit(t, "anon", [{ sessionId: "s1" }]);
    await visit(t, maker, [{ name: "$identify", sessionId: "s2", properties: { anonDistinctId: "anon-2" } }]);

    const { page } = await server.query(api.analytics.people, { adminId: boss, cursor: null });
    expect(new Set(page.map((person) => person.username))).toEqual(new Set([null, "boss", "maker"]));
    expect(await server.query(api.analytics.findPerson, { adminId: boss, search: "@Maker" })).toBe(maker);
    expect(await server.query(api.analytics.findPerson, { adminId: boss, search: "anon" })).toBe("anon");
    expect(await server.query(api.analytics.findPerson, { adminId: boss, search: "nobody" })).toBeNull();

    const detail = await server.query(api.analytics.person, { adminId: boss, distinctId: "anon-2" });
    expect(detail?.username).toBe("maker");
    expect(detail?.sessions.map((session) => session.sessionId)).toEqual(["s2"]);
    expect(detail?.events.map((event) => event.name)).toEqual(["$identify", "signed up"]);

    const session = await server.query(api.analytics.session, { adminId: boss, sessionId: "s2" });
    expect(session?.username).toBe("maker");
    expect(session?.events.map((event) => event.name)).toEqual(["$identify"]);
    expect(await server.query(api.analytics.eventNames, { adminId: boss })).toEqual(
      expect.arrayContaining(["$pageview", "$identify", "signed up"]),
    );
  });

  it("forgets a person when an admin asks, and logs it", async () => {
    vi.useFakeTimers();
    const { t, server } = setup();
    const boss = await admin(t, server);
    await visit(t, "leaving", [{}, { name: "$autocapture" }]);
    expect(await server.mutation(api.analytics.forget, { adminId: boss, distinctId: "leaving" })).toBe(true);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(components.analytics.persons.get, { distinctId: "leaving" })).toBeNull();
    const [entry] = await server.query(api.team.log, {});
    expect(entry).toMatchObject({ actor: "boss", action: { type: "forgetPerson" }, target: "visitor leaving" });
    expect(await server.mutation(api.analytics.forget, { adminId: boss, distinctId: "leaving" })).toBe(false);
  });

  it("shows who's here now to admins only", async () => {
    const { t, server } = setup();
    const boss = await admin(t, server);
    const someone = await makeUser(server, "someone");
    await visit(t, "a", [{ path: "/wall" }]);
    await visit(t, "b", [{ sessionId: "other", path: "/wall" }]);
    const live = await server.query(api.analytics.live, { asUser: boss });
    expect(live?.here).toBe(2);
    expect(live?.pages).toEqual([{ path: "/wall", people: 2 }]);
    expect(live?.events[0]?.name).toBe("$pageview");
    expect(await server.query(api.analytics.live, { asUser: someone })).toBeNull();
    expect(await t.withIdentity({ subject: boss }).query(api.analytics.live, {})).not.toBeNull();
  });
});

describe("flags and experiments", () => {
  async function admin(t: ReturnType<typeof setup>["t"], server: Server, name = "boss"): Promise<Id<"users">> {
    const userId = await makeUser(server, name);
    await t.run(async (ctx) => await ctx.db.patch(userId, { role: "admin" }));
    return userId;
  }

  async function visit(t: ReturnType<typeof setup>["t"], distinctId: string, events: Record<string, unknown>[]) {
    const response = await t.fetch("/a/e", {
      method: "POST",
      body: batch(events.map((event) => ({ distinctId, ...event }))),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
    expect(response.ok).toBe(true);
  }

  const flag = {
    key: "wall-order",
    name: "Wall order",
    description: "Which slops come first.",
    active: false,
    variants: [
      { key: "control", weight: 1 },
      { key: "newest", weight: 1 },
    ],
    conditions: [{ filters: [], rollout: 100, variant: null }],
    payloads: {},
  };

  async function log(server: Server) {
    return (await server.query(api.team.log, {})).map(({ action, target }) => ({ action, target })).reverse();
  }

  it("keeps flags for the server to evaluate, and lets admins alone change them", async () => {
    const { t, server } = setup();
    const boss = await admin(t, server);
    const moderator = await makeUser(server, "mod");
    await t.run(async (ctx) => await ctx.db.patch(moderator, { role: "moderator" }));

    await expect(t.query(api.analytics.flagDefinitions, {})).rejects.toThrow("Only the Slopper server");
    await expect(server.mutation(api.analytics.saveFlag, { adminId: moderator, flag })).rejects.toThrow();
    expect(await server.mutation(api.analytics.saveFlag, { adminId: boss, flag })).toEqual({ created: true });
    // Saved off: nothing to evaluate until it's turned on.
    expect(await server.query(api.analytics.flagDefinitions, {})).toEqual([]);
    expect(await server.mutation(api.analytics.setFlagActive, { adminId: boss, key: "wall-order", active: true })).toBe(
      true,
    );
    expect((await server.query(api.analytics.flagDefinitions, {})).map((definition) => definition.key)).toEqual([
      "wall-order",
    ]);
    // Changing a flag keeps whether it's on.
    await server.mutation(api.analytics.saveFlag, { adminId: boss, flag: { ...flag, name: "Order of the wall" } });
    expect(await server.query(api.analytics.flagDefinitions, {})).toHaveLength(1);
    expect(await server.query(api.analytics.flag, { adminId: boss, key: "wall-order" })).toMatchObject({
      flag: { name: "Order of the wall", active: true },
      experiments: [],
    });
    expect(await server.mutation(api.analytics.removeFlag, { adminId: boss, key: "wall-order" })).toBe(true);
    expect(await server.mutation(api.analytics.removeFlag, { adminId: boss, key: "wall-order" })).toBe(false);
    expect(await log(server)).toEqual([
      { action: { type: "flag", change: "created" }, target: "wall-order" },
      { action: { type: "flag", change: "on" }, target: "wall-order" },
      { action: { type: "flag", change: "changed" }, target: "wall-order" },
      { action: { type: "flag", change: "deleted" }, target: "wall-order" },
    ]);
  });

  it("runs an experiment and counts who reached the goal after seeing a variant", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { t, server } = setup();
    const boss = await admin(t, server);
    await server.mutation(api.analytics.saveFlag, { adminId: boss, flag });
    const experiment = {
      key: "newest-first",
      name: "Newest first",
      hypothesis: "Newest first gets more upvotes.",
      flagKey: "wall-order",
      goal: { event: "slop upvoted", filters: [] },
    };
    expect(await server.mutation(api.analytics.saveExperiment, { adminId: boss, experiment })).toEqual({
      created: true,
    });
    const draft = await server.action(api.analytics.experimentResults, { adminId: boss, key: "newest-first" });
    expect(draft).toMatchObject({ experiment: { status: "draft" }, result: null });
    expect(await server.action(api.analytics.experimentResults, { adminId: boss, key: "missing" })).toBeNull();

    await server.mutation(api.analytics.startExperiment, { adminId: boss, key: "newest-first" });
    expect((await server.query(api.analytics.flagDefinitions, {}))[0]?.key).toBe("wall-order");
    const seen = (variant: string) => ({ name: "$featureFlagCalled", properties: { flag: "wall-order", variant } });
    vi.advanceTimersByTime(1_000);
    await visit(t, "a", [seen("control")]);
    await visit(t, "b", [seen("newest")]);
    // Someone who reached the goal before they saw the flag doesn't count as converted.
    await visit(t, "c", [{ name: "slop upvoted" }]);
    vi.advanceTimersByTime(1_000);
    await visit(t, "a", [{ name: "slop upvoted" }]);
    await visit(t, "c", [seen("newest")]);
    // A flag someone saw before the experiment started isn't part of it, nor is another flag.
    await visit(t, "d", [
      { ...seen("control"), timestamp: Date.now() - 60_000 },
      { name: "$featureFlagCalled", properties: { flag: "other", variant: "x" } },
    ]);

    const running = await server.action(api.analytics.experimentResults, { adminId: boss, key: "newest-first" });
    expect(running?.truncated).toBe(false);
    expect(running?.result?.variants.map(({ key, exposed, converted }) => ({ key, exposed, converted }))).toEqual([
      { key: "control", exposed: 1, converted: 1 },
      { key: "newest", exposed: 2, converted: 0 },
    ]);
    expect(running?.result?.winner).toBeNull();

    await expect(server.mutation(api.analytics.removeFlag, { adminId: boss, key: "wall-order" })).rejects.toThrow(
      "uses this flag",
    );
    await server.mutation(api.analytics.stopExperiment, { adminId: boss, key: "newest-first" });
    vi.advanceTimersByTime(1_000);
    // What happens after it stopped isn't counted.
    await visit(t, "b", [{ name: "slop upvoted" }]);
    const stopped = await server.action(api.analytics.experimentResults, { adminId: boss, key: "newest-first" });
    expect(stopped?.result?.variants.find((variant) => variant.key === "newest")?.converted).toBe(0);
    expect(await server.mutation(api.analytics.removeExperiment, { adminId: boss, key: "newest-first" })).toBe(true);
    expect((await log(server)).slice(1)).toEqual([
      { action: { type: "experiment", change: "created" }, target: "newest-first" },
      { action: { type: "experiment", change: "started" }, target: "newest-first" },
      { action: { type: "experiment", change: "stopped" }, target: "newest-first" },
      { action: { type: "experiment", change: "deleted" }, target: "newest-first" },
    ]);
  });
});

describe("surveys", () => {
  it("are served to the app server, changed by admins only, and logged", async () => {
    const { t, server } = setup();
    const boss = await makeUser(server, "boss");
    await t.run(async (ctx) => await ctx.db.patch(boss, { role: "admin" }));
    const moderator = await makeUser(server, "mod");
    await t.run(async (ctx) => await ctx.db.patch(moderator, { role: "moderator" }));
    const survey = {
      key: "wall-rating",
      name: "Wall rating",
      question: "How easy was it?",
      kind: "rating" as const,
      choices: [],
      followUp: null,
      target: { pathPrefix: "/wall", signedIn: null, delaySeconds: 0 },
    };
    await expect(t.query(api.analytics.surveyDefinitions, {})).rejects.toThrow("Only the Slopper server");
    await expect(server.mutation(api.analytics.saveSurvey, { adminId: moderator, survey })).rejects.toThrow();
    await server.mutation(api.analytics.saveSurvey, { adminId: boss, survey });
    await server.mutation(api.analytics.startSurvey, { adminId: boss, key: "wall-rating" });
    expect((await server.query(api.analytics.surveyDefinitions, {})).map((definition) => definition.key)).toEqual([
      "wall-rating",
    ]);
    await t.fetch("/a/e", {
      method: "POST",
      body: batch([
        { name: "$surveyShown", path: "/wall", properties: { survey: "wall-rating" } },
        { name: "$surveySent", path: "/wall", properties: { survey: "wall-rating", value: 4, text: "Nice" } },
      ]),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
    const now = Date.now();
    const answer = await server.action(api.analytics.insight, {
      adminId: boss,
      query: { kind: "survey", key: "wall-rating", question: "rating", range: { from: now - 60_000, to: now + 1 } },
    });
    expect(answer.result).toMatchObject({ kind: "survey", shown: 1, answered: 1, average: 4 });
    await server.mutation(api.analytics.stopSurvey, { adminId: boss, key: "wall-rating" });
    await server.mutation(api.analytics.removeSurvey, { adminId: boss, key: "wall-rating" });
    const log = (await server.query(api.team.log, {})).map(({ action }) => action).reverse();
    expect(log).toEqual([
      { type: "survey", change: "created" },
      { type: "survey", change: "started" },
      { type: "survey", change: "stopped" },
      { type: "survey", change: "deleted" },
    ]);
  });
});

describe("web vitals", () => {
  it("answer how fast pages load for admins", async () => {
    const { t, server } = setup();
    const boss = await makeUser(server, "boss");
    await t.run(async (ctx) => await ctx.db.patch(boss, { role: "admin" }));
    await t.fetch("/a/e", {
      method: "POST",
      body: batch([
        { name: "$webVitals", path: "/wall", properties: { lcp: 1_200, cls: 0.01, inp: 90 } },
        { name: "$webVitals", path: "/wall", properties: { lcp: 4_500, cls: 0.3, inp: 700 } },
      ]),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
    const now = Date.now();
    const answer = await server.action(api.analytics.insight, {
      adminId: boss,
      query: { kind: "vitals", range: { from: now - 86_400_000, to: now + 1 } },
    });
    if (answer.result.kind !== "vitals") throw new Error("Not a vitals answer.");
    expect(answer.result.loads).toBe(2);
    expect(answer.result.vitals.lcp).toMatchObject({ p75: 4_500, rating: "poor", samples: 2 });
    expect(answer.result.pages).toEqual([expect.objectContaining({ path: "/wall", loads: 2 })]);
  });
});

describe("errors", () => {
  it("keeps server errors with browsers' for admins to read as issues", async () => {
    const { t, server } = setup();
    const boss = await makeUser(server, "boss");
    await t.run(async (ctx) => await ctx.db.patch(boss, { role: "admin" }));
    const error = { type: "Error", message: "Slop 42 is gone", stack: "Error: Slop 42 is gone", fingerprint: "f-gone" };
    await expect(
      t.mutation(api.analytics.captureServerError, { distinctId: null, path: "/wall", ...error }),
    ).rejects.toThrow("Only the Slopper server");
    await server.mutation(api.analytics.captureServerError, { distinctId: "visitor-e", path: "/wall", ...error });
    await server.mutation(api.analytics.captureServerError, { distinctId: null, path: "/today", ...error });
    await t.fetch("/a/e", {
      method: "POST",
      body: batch([
        {
          distinctId: "visitor-e",
          name: "$exception",
          path: "/wall",
          properties: { type: "TypeError", message: "x is undefined", fingerprint: "f-browser", source: "uncaught" },
        },
      ]),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
    const now = Date.now();
    const query = { kind: "errors" as const, range: { from: now - 86_400_000, to: now + 1 } };
    const answer = await server.action(api.analytics.insight, { adminId: boss, query });
    if (answer.result.kind !== "errors") throw new Error("Not an errors answer.");
    expect(answer.result.issues.map((issue) => [issue.fingerprint, issue.count, issue.people, issue.sources])).toEqual([
      ["f-gone", 2, 2, ["server"]],
      ["f-browser", 1, 1, ["uncaught"]],
    ]);
    const one = await server.action(api.analytics.insight, {
      adminId: boss,
      query: { ...query, fingerprint: "f-gone" },
    });
    if (one.result.kind !== "errors") throw new Error("Not an errors answer.");
    expect(one.result.occurrences.map((occurrence) => occurrence.path)).toEqual(
      expect.arrayContaining(["/today", "/wall"]),
    );
  });
});

describe("heatmaps", () => {
  it("answer where people clicked on a page, for admins", async () => {
    const { t, server } = setup();
    const boss = await makeUser(server, "boss");
    await t.run(async (ctx) => await ctx.db.patch(boss, { role: "admin" }));
    await t.fetch("/a/e", {
      method: "POST",
      body: batch([
        { name: "$pageview", path: "/wall", properties: { viewportWidth: 1280 } },
        { name: "$heatmap", path: "/wall", properties: { viewportWidth: 1280, points: ["100,200", "101,201"] } },
        { name: "$pageleave", path: "/wall", properties: { viewportWidth: 1280, scrollDepth: 0.5 } },
      ]),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
    const now = Date.now();
    const query = {
      kind: "heatmap" as const,
      range: { from: now - 86_400_000, to: now + 1 },
      path: "/wall",
      device: "desktop" as const,
    };
    const answer = await server.action(api.analytics.insight, { adminId: boss, query });
    expect(answer.result).toMatchObject({ kind: "heatmap", clicks: 2, views: 1, cells: [{ clicks: 2 }] });
    const someone = await makeUser(server, "someone");
    await expect(server.action(api.analytics.insight, { adminId: someone, query })).rejects.toThrow();
  });
});

describe("session recordings", () => {
  async function admin(t: ReturnType<typeof setup>["t"], server: Server): Promise<Id<"users">> {
    const userId = await makeUser(server, "boss");
    await t.run(async (ctx) => await ctx.db.patch(userId, { role: "admin" }));
    return userId;
  }

  function chunk(params: Record<string, string>, body: BodyInit, headers: Record<string, string> = {}) {
    const now = Date.now();
    const query = new URLSearchParams({
      s: "session-r",
      d: "visitor-r",
      from: String(now - 2_000),
      to: String(now - 1_000),
      n: "2",
      z: "1",
      t: String(now),
      ...params,
    });
    return {
      path: `/a/r?${query.toString()}`,
      init: {
        method: "POST",
        body,
        headers: { origin: "https://slopper.day", "user-agent": CHROME, "content-type": "text/plain", ...headers },
      },
    };
  }

  it("takes chunks from the site's browsers and hands admins the session's recording", async () => {
    const { t, server } = setup();
    const boss = await admin(t, server);
    const gzipped = new Uint8Array(gzipSync(JSON.stringify([{ type: 4, timestamp: 1 }])));
    await t.fetch("/a/e", {
      method: "POST",
      body: batch([{ distinctId: "visitor-r", sessionId: "session-r" }]),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
    const sent = chunk({}, gzipped);
    const response = await t.fetch(sent.path, sent.init);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://slopper.day");
    expect(await response.json()).toEqual({ stored: true });

    const found = await server.query(api.analytics.session, { adminId: boss, sessionId: "session-r" });
    expect(found?.recording?.recording).toMatchObject({ sessionId: "session-r", chunks: 1, events: 2 });
    expect(found?.recording?.chunks).toEqual([expect.objectContaining({ encoding: "gzip" })]);

    const listed = await server.query(api.analytics.recordings, { adminId: boss, cursor: null });
    expect(listed.page.map(({ recording, session }) => [recording.sessionId, session?.pageviews])).toEqual([
      ["session-r", 1],
    ]);
    const person = await server.query(api.analytics.person, { adminId: boss, distinctId: "visitor-r" });
    expect(person?.recorded).toEqual(["session-r"]);
  });

  it("refuses other sites, bad chunks and crawlers", async () => {
    const { t, server } = setup();
    const boss = await admin(t, server);
    const body = "[]";
    const other = chunk({}, body, { origin: "https://evil.example" });
    expect((await t.fetch(other.path, other.init)).status).toBe(403);
    const unordered = chunk({ from: "10", to: "5" }, body);
    expect((await t.fetch(unordered.path, unordered.init)).status).toBe(400);
    const bot = chunk({}, body, { "user-agent": "Googlebot/2.1" });
    expect((await t.fetch(bot.path, bot.init)).status).toBe(204);
    // A week old by a clock that agrees with the server's: too old to keep.
    const old = Date.now() - 8 * 86_400_000;
    const week = chunk({ from: String(old), to: String(old + 1), t: String(Date.now()) }, body);
    expect(await (await t.fetch(week.path, week.init)).json()).toEqual({ stored: false });
    // A browser whose clock is far behind: its times move to the server's, and it's kept.
    const skewed = chunk({ from: "1000", to: "2000", t: "3000" }, body);
    expect(await (await t.fetch(skewed.path, skewed.init)).json()).toEqual({ stored: true });
    const [kept] = (await server.query(api.analytics.recordings, { adminId: boss, cursor: null })).page;
    expect(kept?.recording.startedAt).toBeGreaterThan(Date.now() - 60_000);
  });
});

describe("analytics by slop", () => {
  const SLOP_INPUT = {
    name: "TiltMaze",
    tagline: "Tilt to play",
    description: "A maze.",
    category: "games",
    links: [],
    screenshots: [],
    madeWith: [],
  };

  async function launch(server: Server, userId: Id<"users">) {
    return await server.mutation(api.slops.create, {
      userId,
      input: SLOP_INPUT,
      launchNote: "Day 1",
    });
  }

  async function view(t: ReturnType<typeof setup>["t"], distinctId: string, path: string, extra: object = {}) {
    await t.fetch("/a/e", {
      method: "POST",
      body: batch([{ distinctId, sessionId: `${distinctId}-session`, path, ...extra }]),
      headers: { origin: "https://slopper.day", "user-agent": CHROME },
    });
  }

  it("counts everything on a slop's page, and votes on it, for that slop", async () => {
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const fan = await makeUser(server, "fan");
    const { slopId } = await launch(server, maker);
    await view(t, "visitor", "/@maker/tiltmaze");
    await view(t, "visitor", "/@Maker/tiltmaze", { name: "$autocapture", properties: { eventType: "click" } });
    await view(t, "visitor", "/wall");
    await view(t, "visitor", "/@maker/nothing-here");
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });

    const about = await t.query(components.analytics.events.recent, { group: `slop:${slopId}` });
    // Usernames aren't case-sensitive in addresses, so "/@Maker/tiltmaze" is its page too.
    expect(about.map((event) => [event.name, event.path])).toEqual([
      ["upvoted", null],
      ["$autocapture", "/@Maker/tiltmaze"],
      ["$pageview", "/@maker/tiltmaze"],
      ["slop launched", null],
    ]);
    const visitor = await t.query(components.analytics.events.recent, { distinctId: "visitor" });
    expect(visitor.filter((event) => event.group === undefined).map((event) => event.path)).toEqual([
      "/@maker/nothing-here",
      "/wall",
    ]);
  });

  it("gives a maker their slop's report, without their own visits", async () => {
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const fan = await makeUser(server, "fan");
    const { slopId } = await launch(server, maker);
    await view(t, maker, "/@maker/tiltmaze");
    await view(t, "visitor", "/@maker/tiltmaze", { properties: { referrer: "https://news.ycombinator.com/" } });
    await view(t, "visitor", "/@maker/tiltmaze", {
      name: "$autocapture",
      properties: { eventType: "click", captureName: "link:website" },
    });
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });

    const answer = await server.action(api.analytics.slopReport, { userId: maker, slopId, days: 30 });
    expect(answer.slop).toMatchObject({ name: "TiltMaze", username: "maker", upvotes: 1 });
    expect(answer.report.totals).toEqual({ views: 1, people: 1, sessions: 1, interactions: 1 });
    expect(answer.report.sources).toEqual([{ value: "news.ycombinator.com", visitors: 1, count: 1 }]);
    expect(answer.report.clicks).toEqual([{ value: "link:website", visitors: 1, count: 1 }]);
    expect(answer.report.actions.map((action) => action.name)).toEqual(["upvoted"]);

    await expect(server.action(api.analytics.slopReport, { userId: fan, slopId, days: 30 })).rejects.toThrow(
      "That slop isn't yours.",
    );
    const boss = await makeUser(server, "boss");
    await t.run(async (ctx) => await ctx.db.patch(boss, { role: "admin" }));
    expect(
      (await server.action(api.analytics.slopReport, { userId: boss, slopId, days: 30 })).report.totals.views,
    ).toBe(1);
    expect(await server.query(api.analytics.slopIdAt, { username: "Maker", slug: "tiltmaze" })).toBe(slopId);
    expect(await server.query(api.analytics.slopIdAt, { username: "maker", slug: "nope" })).toBeNull();
  });

  it("never tells a maker about downvotes, which are private", async () => {
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const critic = await makeUser(server, "critic");
    const { slopId } = await launch(server, maker);
    await server.mutation(api.slops.vote, { userId: critic, slopId, value: -1 });
    await server.mutation(api.slops.vote, { userId: critic, slopId, value: 0 });
    const answer = await server.action(api.analytics.slopReport, { userId: maker, slopId, days: 30 });
    expect(answer.report.actions).toEqual([]);
    // Admins' analytics still know, for the platform's health.
    const about = await t.query(components.analytics.events.recent, { group: `slop:${slopId}` });
    expect(about.map((event) => event.name)).toEqual(["unvoted", "downvoted", "slop launched"]);
  });

  it("shows admins growth, and which slops are climbing", async () => {
    const { t, server } = setup();
    const boss = await makeUser(server, "boss");
    await t.run(async (ctx) => await ctx.db.patch(boss, { role: "admin" }));
    const maker = await makeUser(server, "maker");
    const { slopId } = await launch(server, maker);
    await view(t, "a", "/@maker/tiltmaze");
    await view(t, "b", "/@maker/tiltmaze");

    const growth = await server.action(api.analytics.growth, { adminId: boss, days: 7 });
    expect(growth.interval).toBe("day");
    expect(growth.totals).toEqual({ accounts: 2, slops: 1, slopcessful: 0, makers: 1 });
    expect(growth.signups.reduce((sum, count) => sum + count, 0)).toBe(2);
    expect(growth.launches.reduce((sum, count) => sum + count, 0)).toBe(1);
    expect(growth.accountsAt.at(-1)).toBe(2);

    const projects = await server.action(api.analytics.projects, { adminId: boss, days: 7 });
    expect(projects).toMatchObject({ active: 1, new: 1, rising: 0, falling: 0, truncated: false });
    expect(projects.rows).toEqual([
      {
        group: `slop:${slopId}`,
        count: 2,
        people: 2,
        previousCount: 0,
        previousPeople: 0,
        slop: expect.objectContaining({ name: "TiltMaze", username: "maker", slug: "tiltmaze" }),
      },
    ]);
    await expect(server.action(api.analytics.growth, { adminId: maker, days: 7 })).rejects.toThrow(
      "Only admins can do that.",
    );
  });
});
