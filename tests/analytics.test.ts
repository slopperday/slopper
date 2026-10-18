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
    expect(response.status).toBe(204);
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
    expect(await names(fan)).toEqual(["pledged", "voted", "signed up"]);

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
