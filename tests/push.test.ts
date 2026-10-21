// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { MAX_BROWSERS } from "@convex/push";
import { isPushEndpoint, parseSubscription } from "~/.server/push";
import { notificationText } from "~/lib/notifications";
import { generateVapidKeys } from "../scripts/server-keys.ts";
import { convexApp } from "./convexApp";

function setup() {
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

type Server = ReturnType<typeof setup>["server"];

async function makeUser(server: Server, name: string): Promise<Id<"users">> {
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: name,
    preferredUsername: name,
    displayName: name,
    avatarUrl: null,
    timeZone: "UTC",
  });
  return userId;
}

async function ship(server: Server, userId: Id<"users">): Promise<Id<"slops">> {
  const { slopId } = await server.mutation(api.slops.create, {
    userId,
    input: {
      name: "TiltMaze",
      tagline: "Tilt to play",
      description: "",
      category: "games",
      links: [{ kind: "website", url: "https://tiltmaze.app/" }],
      screenshots: [],
      madeWith: [],
    },
    launchNote: "Day 1",
  });
  return slopId;
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

/** A real browser's keys, so delivery encrypts for real. */
async function browserKeys() {
  const browser = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  return {
    p256dh: base64url(new Uint8Array(await crypto.subtle.exportKey("raw", browser.publicKey))),
    auth: base64url(crypto.getRandomValues(new Uint8Array(16))),
  };
}

const LIVE = "https://fcm.googleapis.com/fcm/send/live";
const GONE = "https://fcm.googleapis.com/fcm/send/gone";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("push subscriptions from browsers", () => {
  const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

  it("accepts the browsers' own push services only", () => {
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("https://updates.push.services.mozilla.com/wpush/v2/abc")).toBe(true);
    expect(isPushEndpoint("https://web.push.apple.com/abc")).toBe(true);
    expect(isPushEndpoint("https://wns2-db5p.notify.windows.com/w/?token=abc")).toBe(true);
    expect(isPushEndpoint("http://fcm.googleapis.com/fcm/send/abc")).toBe(false);
    expect(isPushEndpoint("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(isPushEndpoint("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://169.254.169.254/latest")).toBe(false);
  });

  it("reads PushSubscription.toJSON() and rejects anything else", () => {
    expect(parseSubscription({ endpoint: LIVE, expirationTime: null, keys })).toEqual({ endpoint: LIVE, ...keys });
    expect(parseSubscription({ endpoint: LIVE, keys: { ...keys, auth: "not base64!" } })).toBeNull();
    expect(parseSubscription({ endpoint: LIVE, keys: { p256dh: "short", auth: keys.auth } })).toBeNull();
    expect(parseSubscription({ endpoint: "https://example.com/", keys })).toBeNull();
    expect(parseSubscription(null)).toBeNull();
  });
});

describe("notification text", () => {
  const slop = { name: "TiltMaze", launchLabel: null };

  it("says the same thing on the page and in the browser", () => {
    expect(notificationText({ kind: "upvote", actorUsername: "fan", slop, amount: null })).toBe(
      "@fan upvoted TiltMaze",
    );
    expect(notificationText({ kind: "pledge", actorUsername: "fan", slop, amount: 1500 })).toBe(
      "@fan pledged $15.00 to TiltMaze",
    );
    expect(
      notificationText({
        kind: "slop_of_the_day",
        actorUsername: null,
        slop: { ...slop, launchLabel: "iOS app" },
        amount: null,
      }),
    ).toBe("🏆 TiltMaze · iOS app won slop of the day");
  });
});

describe("browser notifications", () => {
  it("keeps one row per browser, owned by whoever turned it on last, and caps browsers", async () => {
    const { t, server } = setup();
    const ada = await makeUser(server, "ada");
    const bo = await makeUser(server, "bo");
    const keys = { p256dh: "B".repeat(87), auth: "a".repeat(22) };

    await server.mutation(api.push.subscribe, { userId: ada, endpoint: LIVE, ...keys });
    await server.mutation(api.push.subscribe, { userId: bo, endpoint: LIVE, ...keys });
    let rows = await t.run((ctx) => ctx.db.query("pushSubscriptions").collect());
    expect(rows.map((row) => row.userId)).toEqual([bo]);

    // Only the browser's owner can turn it off.
    await server.mutation(api.push.unsubscribe, { userId: ada, endpoint: LIVE });
    expect(await t.run((ctx) => ctx.db.query("pushSubscriptions").collect())).toHaveLength(1);
    await server.mutation(api.push.unsubscribe, { userId: bo, endpoint: LIVE });
    expect(await t.run((ctx) => ctx.db.query("pushSubscriptions").collect())).toHaveLength(0);

    for (let n = 0; n <= MAX_BROWSERS; n++) {
      await server.mutation(api.push.subscribe, { userId: ada, endpoint: `${LIVE}-${n}`, ...keys });
    }
    rows = await t.run((ctx) => ctx.db.query("pushSubscriptions").collect());
    expect(rows).toHaveLength(MAX_BROWSERS);
    expect(rows.map((row) => row.endpoint)).not.toContain(`${LIVE}-0`);
  });

  it("is only for the server", async () => {
    const { t, server } = setup();
    const ada = await makeUser(server, "ada");
    await expect(
      t
        .withIdentity({ subject: ada })
        .mutation(api.push.subscribe, { userId: ada, endpoint: LIVE, p256dh: "B".repeat(87), auth: "a".repeat(22) }),
    ).rejects.toThrow();
  });

  it("schedules nothing for people who never turned them on", async () => {
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const fan = await makeUser(server, "fan");
    const slopId = await ship(server, maker);
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });
    expect(await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect())).toEqual([]);
  });

  it("says what happened and links to the slop", async () => {
    // Held, so the send it schedules doesn't run.
    vi.useFakeTimers();
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const fan = await makeUser(server, "fan");
    const slopId = await ship(server, maker);
    const { p256dh, auth } = await browserKeys();
    await server.mutation(api.push.subscribe, { userId: maker, endpoint: LIVE, p256dh, auth });
    await server.mutation(api.slops.pledge, { userId: fan, slopId, amount: 2500 });

    const [notification] = await t.run((ctx) => ctx.db.query("notifications").collect());
    const slop = await t.run((ctx) => ctx.db.get(slopId));
    const delivery = await t.query(internal.push.delivery, { notificationId: notification._id });
    expect(delivery).toEqual({
      subscriptions: [{ endpoint: LIVE, keys: { p256dh, auth } }],
      message: { title: "Slopper", body: "@fan pledged $25.00 to TiltMaze", url: `/@maker/${slop?.slug}`, tag: slopId },
    });
  });

  it("sends each new notification to the owner's browsers and forgets the ones that are gone", async () => {
    vi.useFakeTimers();
    const { p256dh, auth } = await browserKeys();
    const vapid = await generateVapidKeys();
    vi.stubEnv("VAPID_PUBLIC_KEY", vapid.publicKey);
    vi.stubEnv("VAPID_PRIVATE_KEY", vapid.privateKey);
    const posts: { endpoint: string; headers: Headers; bytes: number }[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const endpoint = input instanceof Request ? input.url : input.toString();
      const bytes = ArrayBuffer.isView(init?.body) ? init.body.byteLength : 0;
      posts.push({ endpoint, headers: new Headers(init?.headers), bytes });
      return new Response(null, { status: endpoint === GONE ? 410 : 201 });
    });

    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const fan = await makeUser(server, "fan");
    const slopId = await ship(server, maker);
    await server.mutation(api.push.subscribe, { userId: maker, endpoint: LIVE, p256dh, auth });
    await server.mutation(api.push.subscribe, { userId: maker, endpoint: GONE, p256dh, auth });

    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posts.map((post) => post.endpoint).sort()).toEqual([LIVE, GONE].sort());
    const live = posts.find((post) => post.endpoint === LIVE);
    expect(live?.headers.get("content-encoding")).toBe("aes128gcm");
    expect(live?.headers.get("authorization")).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(live?.bytes).toBeGreaterThan(0);

    // The gone browser is forgotten, so the next upvote reaches only the live
    // one. An hour passes first: an upvote notifies its owner once an hour,
    // not once per toggle.
    posts.length = 0;
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 0 });
    vi.advanceTimersByTime(3_600_001);
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(posts.map((post) => post.endpoint)).toEqual([LIVE]);
  });

  it("stays quiet without a VAPID key", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const { t, server } = setup();
    const maker = await makeUser(server, "maker");
    const fan = await makeUser(server, "fan");
    const slopId = await ship(server, maker);
    const { p256dh, auth } = await browserKeys();
    await server.mutation(api.push.subscribe, { userId: maker, endpoint: LIVE, p256dh, auth });
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
