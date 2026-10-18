// @vitest-environment edge-runtime
import process from "node:process";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, components } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { analyticsOptedOut, analyticsSetup, countryOf } from "~/.server/analytics";
import { loadConfig } from "~/.server/config";
import { sanitizeAnalyticsPath } from "~/lib/analytics";
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
    expect(await response.json()).toEqual({ stored: 1, duplicates: 0, dropped: 0 });
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
      today: new Date().toISOString().slice(0, 10),
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
      today: new Date().toISOString().slice(0, 10),
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
