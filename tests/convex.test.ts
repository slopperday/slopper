// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { describe, expect, it } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import schema from "@convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
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

const input = {
  name: "TiltMaze",
  tagline: "Tilt to play",
  description: "**Bold** <script>alert(1)</script>",
  category: "games",
  nsfw: false,
  links: [{ kind: "website" as const, url: "https://tiltmaze.app/" }],
  screenshots: [],
  madeWith: [],
};

async function ship(server: Server, userId: Id<"users">, today: string, extra: object = {}) {
  return await server.mutation(api.slops.create, { userId, input, launchNote: "Day 1", today, ...extra });
}

describe("auth roles", () => {
  it("refuses privileged writes from anyone but the server", async () => {
    const { t, server } = setup();
    const userId = await makeUser(server, "ifiok");
    await expect(ship(t.withIdentity({ subject: userId }), userId, "2026-10-06")).rejects.toThrow(
      "Only the Slopper server",
    );
    await expect(
      t.mutation(api.users.upsertFromIdentity, {
        provider: "github",
        providerId: "1",
        preferredUsername: "x",
        displayName: "x",
        avatarUrl: null,
        timeZone: "UTC",
      }),
    ).rejects.toThrow("Only the Slopper server");
  });
});

describe("users", () => {
  it("reuses identities and suffixes clashing usernames", async () => {
    const { server } = setup();
    const first = await server.mutation(api.users.upsertFromIdentity, {
      provider: "github",
      providerId: "1",
      preferredUsername: "Ifiok",
      displayName: "Ifiok",
      avatarUrl: null,
      timeZone: "Europe/London",
    });
    const again = await server.mutation(api.users.upsertFromIdentity, {
      provider: "github",
      providerId: "1",
      preferredUsername: "ifiok",
      displayName: "Ifiok",
      avatarUrl: null,
      timeZone: "UTC",
    });
    const google = await server.mutation(api.users.upsertFromIdentity, {
      provider: "google",
      providerId: "g",
      preferredUsername: "ifiok",
      displayName: "Other",
      avatarUrl: null,
      timeZone: "Not/AZone",
    });
    expect(again).toEqual({ userId: first.userId, created: false });
    const other = await server.query(api.users.get, { userId: google.userId });
    expect(other?.username).toBe("ifiok-2");
    expect(other?.timeZone).toBe("UTC");
  });

  it("resolves sessions by hash until they expire", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "ifiok");
    await server.mutation(api.users.createSession, { userId, tokenHash: "h1", expiresAt: Date.now() + 60_000 });
    await server.mutation(api.users.createSession, { userId, tokenHash: "h2", expiresAt: Date.now() - 1 });
    expect((await server.query(api.users.resolveSession, { tokenHash: "h1" }))?._id).toBe(userId);
    expect(await server.query(api.users.resolveSession, { tokenHash: "h2" })).toBeNull();
    expect(await server.query(api.users.resolveSession, { tokenHash: "nope" })).toBeNull();
  });
});

describe("launching", () => {
  it("counts towards the goal, numbers launches and links relaunches", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "ifiok");
    const today = "2026-10-06";
    const goal = await server.mutation(api.goals.create, {
      userId,
      title: "30 in 30",
      target: 30,
      days: 30,
      startDate: "2026-10-05",
      today,
    });
    expect(goal.ok).toBe(true);

    const first = await ship(server, userId, today);
    const relaunch = await ship(server, userId, today, { relaunchOf: first.slopId, launchLabel: "iOS beta" });
    const doc = await server.query(api.slops.getForServer, { slopId: relaunch.slopId });
    expect(first.slug).toBe("tiltmaze");
    expect(relaunch.slug).toBe("tiltmaze-ios-beta");
    expect(doc?.productId).toBe(first.slopId);
    expect(doc?.number).toBe(2);
    expect(doc?.goalDay).toBe(2);

    const page = await server.query(api.slops.page, { username: "ifiok", slug: "tiltmaze" });
    expect(page?.launches.map((launch) => launch.title)).toEqual(["First launch", "iOS beta"]);
    expect(page?.descriptionHtml).toContain("&lt;script&gt;");
    // Downvotes and auto-post wiring never leave Convex.
    expect(page?.slop).not.toHaveProperty("downvotes");
    expect(page?.slop).not.toHaveProperty("crosspost");
  });

  it("requires a label for relaunches and only one open goal", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "ifiok");
    const first = await ship(server, userId, "2026-10-06");
    await expect(ship(server, userId, "2026-10-06", { relaunchOf: first.slopId })).rejects.toThrow(
      "Say what's launching",
    );
    const card = { userId, title: "7 in 7", target: 7, days: 7, startDate: "2026-10-06", today: "2026-10-06" };
    expect((await server.mutation(api.goals.create, card)).ok).toBe(true);
    expect(await server.mutation(api.goals.create, card)).toEqual({
      ok: false,
      error: "Finish or drop your current goal first.",
    });
  });
});

describe("votes, pledges and notifications", () => {
  it("toggles votes, keeps downvotes private and notifies on upvotes", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const fan = await makeUser(server, "fan");
    const hater = await makeUser(server, "hater");
    const { slopId } = await ship(server, owner, "2026-10-06");

    await expect(server.mutation(api.slops.vote, { userId: owner, slopId, value: 1 })).rejects.toThrow(
      "can't vote on your own",
    );
    expect(await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 })).toEqual({ upvotes: 1, vote: 1 });
    await server.mutation(api.slops.vote, { userId: hater, slopId, value: -1 });
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: -1 });
    let doc = await server.query(api.slops.getForServer, { slopId });
    expect([doc?.upvotes, doc?.downvotes]).toEqual([0, 2]);
    await server.mutation(api.slops.vote, { userId: fan, slopId, value: 0 });
    doc = await server.query(api.slops.getForServer, { slopId });
    expect([doc?.upvotes, doc?.downvotes]).toEqual([0, 1]);

    await server.mutation(api.slops.pledge, { userId: fan, slopId, amount: 1000 });
    await server.mutation(api.slops.pledge, { userId: hater, slopId, amount: 500 });
    await server.mutation(api.slops.pledge, { userId: fan, slopId, amount: 0 });
    doc = await server.query(api.slops.getForServer, { slopId });
    expect([doc?.backers, doc?.pledged]).toEqual([1, 500]);

    const asOwner = t.withIdentity({ subject: owner });
    const kinds = (await asOwner.query(api.notifications.mine, {})).map((item) => item.kind).sort();
    expect(kinds).toEqual(["pledge", "pledge", "upvote"]);
    expect(await asOwner.query(api.notifications.unreadCount, {})).toBe(3);
    await asOwner.mutation(api.notifications.markAllRead, {});
    expect(await asOwner.query(api.notifications.unreadCount, {})).toBe(0);
  });

  it("reports malformed ids as not found instead of crashing", async () => {
    const { server } = setup();
    const fan = await makeUser(server, "fan");
    await expect(server.mutation(api.slops.vote, { userId: fan, slopId: "not-an-id", value: 1 })).rejects.toThrow(
      "Slop not found",
    );
  });
});

describe("slop of the day", () => {
  it("ranks by net votes and crowns yesterday's leader once", async () => {
    const { t, server } = setup();
    const a = await makeUser(server, "a");
    const b = await makeUser(server, "b");
    const voter = await makeUser(server, "voter");
    const first = await ship(server, a, "2026-10-06");
    const second = await ship(server, b, "2026-10-06");
    await server.mutation(api.slops.vote, { userId: voter, slopId: second.slopId, value: 1 });
    await server.mutation(api.slops.vote, { userId: a, slopId: second.slopId, value: 1 });
    await server.mutation(api.slops.vote, { userId: voter, slopId: first.slopId, value: 1 });

    const date = new Date().toISOString().slice(0, 10);
    const race = await server.query(api.race.day, { date });
    expect(race.items.map((item) => item.slop.id)).toEqual([second.slopId, first.slopId]);
    expect(race.final).toBe(false);

    await t.mutation(internal.race.crown, { date });
    await t.mutation(internal.race.crown, { date });
    const crowned = await server.query(api.race.day, { date });
    expect(crowned.winnerId).toBe(second.slopId);
    expect((await server.query(api.slops.getForServer, { slopId: second.slopId }))?.slopOfTheDay).toBe(date);
    expect((await server.query(api.race.champion, {}))?.item.slop.id).toBe(second.slopId);
  });
});

describe("money", () => {
  it("keeps line items private and totals public only when opted in", async () => {
    const { server } = setup();
    const owner = await makeUser(server, "owner");
    const visitor = await makeUser(server, "visitor");
    const { slopId } = await ship(server, owner, "2026-10-06");
    await server.mutation(api.money.add, {
      userId: owner,
      slopId,
      kind: "cost",
      amount: 1299,
      currency: "USD",
      category: "domain",
      note: "tiltmaze.app",
      date: "2026-10-06",
    });
    const asVisitor = () => server.query(api.slops.page, { username: "owner", slug: "tiltmaze", asUser: visitor });
    expect((await asVisitor())?.money).toEqual({ isPublic: false, totals: [], entries: [] });

    await server.mutation(api.money.setPublic, { userId: owner, slopId, visible: true });
    const money = (await asVisitor())?.money;
    expect(money?.totals).toEqual([{ currency: "USD", spent: 1299, made: 0, net: -1299 }]);
    expect(money?.entries).toEqual([]);

    const own = await server.query(api.slops.page, { username: "owner", slug: "tiltmaze", asUser: owner });
    expect(own?.money.entries).toHaveLength(1);
  });
});
