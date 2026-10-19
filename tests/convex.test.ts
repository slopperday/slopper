// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { can, permissionsOf } from "@convex/lib/permissions";
import { EDITING_CLOSED } from "~/lib/editing";
import { convexApp } from "./convexApp";

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

/** Someone on the moderation team, as /mod/team would make them. */
async function makeStaff(
  t: ReturnType<typeof setup>["t"],
  server: Server,
  name: string,
  role: "admin" | "moderator",
): Promise<Id<"users">> {
  const userId = await makeUser(server, name);
  await t.run(async (ctx) => await ctx.db.patch(userId, { role }));
  return userId;
}

const input = {
  name: "TiltMaze",
  tagline: "Tilt to play",
  description: "**Bold** <script>alert(1)</script>",
  category: "games",
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

describe("editing a launch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const edited = { ...input, tagline: "Tilt harder" };

  it("stays open 12 hours after a late launch, then only takes updates", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-17T22:00:00Z"));
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const flagger = await makeUser(server, "flagger");
    const admin = await makeStaff(t, server, "admin", "admin");
    const { slopId } = await ship(server, owner, "2026-10-17");
    const edit = () => server.mutation(api.slops.edit, { userId: owner, slopId, input: edited });

    vi.setSystemTime(Date.parse("2026-10-18T09:59:00Z"));
    await expect(edit()).resolves.toEqual({ blurred: false, orphaned: 0 });

    vi.setSystemTime(Date.parse("2026-10-18T10:01:00Z"));
    await expect(edit()).rejects.toThrow(EDITING_CLOSED);
    await server.mutation(api.activity.addUpdate, { userId: owner, slopId, kind: "feature", body: "Level editor" });
    // The promo video and moderators aren't held to the window.
    expect(await server.mutation(api.videos.set, { userId: owner, slopId, mediaId: null })).toMatchObject({
      status: "none",
    });
    await server.mutation(api.moderation.flag, { userId: flagger, slopId, reason: "Spam" });
    await server.mutation(api.moderation.decide, { moderatorId: admin, slopId, decision: "nsfw" });
    await server.mutation(api.slops.setHidden, { adminId: admin, slopId, hidden: true });

    const page = await server.query(api.slops.page, { username: "owner", slug: "tiltmaze", asUser: owner });
    expect(page?.slop).toMatchObject({ tagline: "Tilt harder", updateCount: 2, nsfw: true, hidden: true });
  });

  it("stays open to the end of the owner's launch day after a morning launch", async () => {
    // 8am in Los Angeles; the day ends at 07:00 UTC.
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-17T15:00:00Z"));
    const { server } = setup();
    const owner = await makeUser(server, "owner", "America/Los_Angeles");
    const { slopId } = await ship(server, owner, "2026-10-17");
    const edit = () => server.mutation(api.slops.edit, { userId: owner, slopId, input: edited });

    vi.setSystemTime(Date.parse("2026-10-18T06:59:00Z"));
    await expect(edit()).resolves.toEqual({ blurred: false, orphaned: 0 });
    vi.setSystemTime(Date.parse("2026-10-18T07:00:00Z"));
    await expect(edit()).rejects.toThrow(EDITING_CLOSED);
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
    expect(await server.mutation(api.slops.vote, { userId: fan, slopId, value: 1 })).toEqual({
      upvotes: 1,
      vote: 1,
      votesLeft: 4,
    });
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

  it("gives everyone five votes a UTC day, and taking one back frees it", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const fan = await makeUser(server, "fan");
    const today = new Date().toISOString().slice(0, 10);
    const slops: Id<"slops">[] = [];
    for (let index = 0; index < 7; index++) slops.push((await ship(server, owner, today)).slopId);
    const vote = (slopId: Id<"slops">, value: 1 | -1 | 0) =>
      server.mutation(api.slops.vote, { userId: fan, slopId, value });
    const left = () => server.query(api.slops.votesLeft, { asUser: fan });

    expect(await server.query(api.slops.votesLeft, {})).toBeNull();
    expect(await left()).toBe(5);
    for (const slopId of slops.slice(0, 4)) await vote(slopId, 1);
    expect((await vote(slops[4], -1)).votesLeft).toBe(0);
    await expect(vote(slops[5], 1)).rejects.toThrow("You've used your 5 votes for today. More at midnight UTC.");

    // Switching today's vote is free, and repeating it changes nothing.
    expect(await vote(slops[4], 1)).toEqual({ upvotes: 1, vote: 1, votesLeft: 0 });
    expect(await vote(slops[4], 1)).toEqual({ upvotes: 1, vote: 1, votesLeft: 0 });
    // Clearing gives it back, to spend elsewhere.
    expect((await vote(slops[0], 0)).votesLeft).toBe(1);
    expect((await vote(slops[5], 1)).votesLeft).toBe(0);
    expect(await left()).toBe(0);

    // A vote from an earlier day doesn't count today, but changing it spends one.
    const old = await t.run(async (ctx) => {
      const id = await ctx.db.insert("votes", { slopId: slops[6], userId: fan, value: 1, castOn: "2026-01-01" });
      await ctx.db.patch(slops[6], { upvotes: 1 });
      return id;
    });
    await expect(vote(slops[6], -1)).rejects.toThrow("used your 5 votes");
    await vote(slops[1], 0);
    expect(await vote(slops[6], -1)).toEqual({ upvotes: 0, vote: -1, votesLeft: 0 });
    expect((await t.run((ctx) => ctx.db.get(old)))?.castOn).toBe(today);
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
  afterEach(() => {
    vi.useRealTimers();
  });

  /** People who joined the day before, so their votes count in the race (`LIMITS.raceVoterAge`). */
  async function people(server: Server, ...names: string[]): Promise<Id<"users">[]> {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse("2026-10-05T09:00:00Z"));
    const ids = [];
    for (const name of names) ids.push(await makeUser(server, name));
    vi.setSystemTime(Date.parse("2026-10-06T10:00:00Z"));
    return ids;
  }

  async function tally(t: ReturnType<typeof setup>["t"], slopId: Id<"slops">) {
    const slop = await t.run((ctx) => ctx.db.get(slopId));
    return {
      upvotes: slop?.upvotes,
      downvotes: slop?.downvotes,
      raceUpvotes: slop?.raceUpvotes,
      raceDownvotes: slop?.raceDownvotes,
    };
  }

  it("ranks by net votes and crowns yesterday's leader once", async () => {
    const { t, server } = setup();
    const [a, b, voter] = await people(server, "a", "b", "voter");
    const first = await ship(server, a, "2026-10-06");
    const second = await ship(server, b, "2026-10-06");
    await server.mutation(api.slops.vote, { userId: voter, slopId: second.slopId, value: 1 });
    await server.mutation(api.slops.vote, { userId: a, slopId: second.slopId, value: 1 });
    await server.mutation(api.slops.vote, { userId: voter, slopId: first.slopId, value: 1 });

    const date = "2026-10-06";
    const race = await server.query(api.race.day, { date });
    expect(race.items.map((item) => item.slop.id)).toEqual([second.slopId, first.slopId]);
    expect(race.final).toBe(false);

    await t.mutation(internal.race.crown, { date });
    await t.mutation(internal.race.crown, { date });
    const crowned = await server.query(api.race.day, { date });
    expect(crowned.winnerId).toBe(second.slopId);
    const winner = await server.query(api.slops.getForServer, { slopId: second.slopId });
    expect(winner?.slopOfTheDay).toBe(date);
    expect((await server.query(api.race.champion, {}))?.item.slop.id).toBe(second.slopId);

    // Winning is what makes a slop slopcessful, logged on its timeline.
    expect(winner?.slopcessfulAt).toEqual(expect.any(Number));
    expect(winner?.slopcessfulNote).toMatch(/^Won slop of the day on .+ with 2 upvotes\.$/);
    expect((await server.query(api.slops.slopcessful, {})).map((item) => item.slop.id)).toEqual([second.slopId]);
    const updates = await t.run((ctx) =>
      ctx.db
        .query("updates")
        .withIndex("by_slop", (q) => q.eq("slopId", second.slopId))
        .collect(),
    );
    expect(updates.map((update) => update.kind)).toEqual(["launch", "slopcessful"]);
    expect((await server.query(api.slops.getForServer, { slopId: first.slopId }))?.slopcessfulAt).toBeNull();
  });

  it("counts only the votes cast on the race day, while the slop keeps collecting", async () => {
    const { t, server } = setup();
    const [maker, rival, early, late, fickle] = await people(server, "maker", "rival", "early", "late", "fickle");
    const slop = await ship(server, maker, "2026-10-06");
    const other = await ship(server, rival, "2026-10-06");
    await server.mutation(api.slops.vote, { userId: early, slopId: slop.slopId, value: 1 });
    await server.mutation(api.slops.vote, { userId: fickle, slopId: slop.slopId, value: 1 });
    await server.mutation(api.slops.vote, { userId: early, slopId: other.slopId, value: 1 });
    // Switching today's vote moves it in the race too.
    await server.mutation(api.slops.vote, { userId: fickle, slopId: slop.slopId, value: -1 });
    await server.mutation(api.slops.vote, { userId: fickle, slopId: slop.slopId, value: 1 });
    expect(await tally(t, slop.slopId)).toEqual({ upvotes: 2, downvotes: 0, raceUpvotes: 2, raceDownvotes: 0 });

    // Just after midnight, before the crown: votes still land on the slop, not in the race.
    vi.setSystemTime(Date.parse("2026-10-07T00:00:30Z"));
    await server.mutation(api.slops.vote, { userId: late, slopId: other.slopId, value: 1 });
    await server.mutation(api.slops.vote, { userId: late, slopId: slop.slopId, value: 1 });
    await server.mutation(api.slops.vote, { userId: fickle, slopId: slop.slopId, value: 0 });
    expect(await tally(t, slop.slopId)).toEqual({ upvotes: 2, downvotes: 0, raceUpvotes: 2, raceDownvotes: 0 });
    expect(await tally(t, other.slopId)).toEqual({ upvotes: 2, downvotes: 0, raceUpvotes: 1, raceDownvotes: 0 });

    await t.mutation(internal.race.crown, {});
    expect((await server.query(api.race.day, { date: "2026-10-06" })).winnerId).toBe(slop.slopId);
    const winner = await server.query(api.slops.getForServer, { slopId: slop.slopId });
    expect(winner?.slopcessfulNote).toMatch(/with 2 upvotes\.$/);
  });

  it("counts new accounts' votes on the slop but not in the race", async () => {
    const { t, server } = setup();
    const [maker] = await people(server, "maker");
    const fresh = await makeUser(server, "fresh");
    const { slopId } = await ship(server, maker, "2026-10-06");
    await server.mutation(api.slops.vote, { userId: fresh, slopId, value: 1 });
    expect(await tally(t, slopId)).toEqual({ upvotes: 1, downvotes: 0, raceUpvotes: 0, raceDownvotes: 0 });
    // Taking it back takes nothing from the race.
    await server.mutation(api.slops.vote, { userId: fresh, slopId, value: 0 });
    expect(await tally(t, slopId)).toEqual({ upvotes: 0, downvotes: 0, raceUpvotes: 0, raceDownvotes: 0 });

    // A day on, the same account counts, but only in a race that's still on.
    vi.setSystemTime(Date.parse("2026-10-07T10:00:00Z"));
    const next = await ship(server, maker, "2026-10-07", { input: { ...input, name: "TiltMaze 2" } });
    await server.mutation(api.slops.vote, { userId: fresh, slopId: next.slopId, value: 1 });
    await server.mutation(api.slops.vote, { userId: fresh, slopId, value: 1 });
    expect(await tally(t, next.slopId)).toEqual({ upvotes: 1, downvotes: 0, raceUpvotes: 1, raceDownvotes: 0 });
    expect(await tally(t, slopId)).toEqual({ upvotes: 1, downvotes: 0, raceUpvotes: 0, raceDownvotes: 0 });
  });

  it("doesn't let makers racing the same day push rivals down or trade upvotes", async () => {
    const { t, server } = setup();
    const [a, b, c, fan] = await people(server, "a", "b", "c", "fan");
    const first = await ship(server, a, "2026-10-06");
    const second = await ship(server, b, "2026-10-06");
    const third = await ship(server, c, "2026-10-06");

    await server.mutation(api.slops.vote, { userId: a, slopId: second.slopId, value: -1 });
    expect(await tally(t, second.slopId)).toEqual({ upvotes: 0, downvotes: 1, raceUpvotes: 0, raceDownvotes: 0 });
    // An upvote from a rival counts, until the other maker returns it.
    await server.mutation(api.slops.vote, { userId: a, slopId: third.slopId, value: 1 });
    expect(await tally(t, third.slopId)).toEqual({ upvotes: 1, downvotes: 0, raceUpvotes: 1, raceDownvotes: 0 });
    await server.mutation(api.slops.vote, { userId: c, slopId: first.slopId, value: 1 });
    expect(await tally(t, first.slopId)).toEqual({ upvotes: 1, downvotes: 0, raceUpvotes: 0, raceDownvotes: 0 });
    expect(await tally(t, third.slopId)).toEqual({ upvotes: 1, downvotes: 0, raceUpvotes: 0, raceDownvotes: 0 });
    // Someone not racing votes as usual.
    await server.mutation(api.slops.vote, { userId: fan, slopId: second.slopId, value: -1 });
    expect(await tally(t, second.slopId)).toEqual({ upvotes: 0, downvotes: 2, raceUpvotes: 0, raceDownvotes: 1 });
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

describe("feedback and kudos", () => {
  // Comments are off in V1 (COMMENTS_ENABLED); the logic stays ready for when they're back.
  it("counts feedback, tells the maker and only sends it when the page asks", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const fan = await makeUser(server, "fan");
    const { slopId } = await ship(server, owner, "2026-10-06");

    await server.mutation(api.activity.addComment, {
      userId: fan,
      slopId,
      kind: "feedback",
      body: "The **tilt** lags.",
    });
    await server.mutation(api.activity.addComment, { userId: fan, slopId, kind: "kudos", body: "Played for an hour." });
    // Talking to yourself doesn't notify you.
    await server.mutation(api.activity.addComment, { userId: owner, slopId, kind: "feedback", body: "Fixed it." });
    expect((await server.query(api.slops.getForServer, { slopId }))?.commentCount).toBe(3);
    const kinds = (await t.withIdentity({ subject: owner }).query(api.notifications.mine, {})).map((item) => item.kind);
    expect(kinds.sort()).toEqual(["feedback", "kudos"]);

    const page = (withComments?: boolean) =>
      server.query(api.slops.page, { username: "owner", slug: "tiltmaze", asUser: fan, withComments });
    expect((await page())?.comments).toEqual([]);
    expect((await page(false))?.comments).toEqual([]);
    const comments = (await page(true))?.comments ?? [];
    expect(comments.map((comment) => comment.kind)).toEqual(["feedback", "kudos", "feedback"]);
    expect(comments[0].html).toContain("<strong>tilt</strong>");
    expect(comments.map((comment) => comment.canDelete)).toEqual([true, true, false]);
  });

  it("lets the author, the maker and admins delete it, and nobody else", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const fan = await makeUser(server, "fan");
    const stranger = await makeUser(server, "stranger");
    const moderator = await makeStaff(t, server, "mia", "moderator");
    const admin = await makeStaff(t, server, "ada", "admin");
    const { slopId } = await ship(server, owner, "2026-10-06");
    const add = () => server.mutation(api.activity.addComment, { userId: fan, slopId, kind: "feedback", body: "Hm." });
    const [first, second, third] = [await add(), await add(), await add()];

    await expect(server.mutation(api.activity.deleteComment, { userId: stranger, commentId: first })).rejects.toThrow(
      "isn't yours",
    );
    // Moderators only approve or reject what's queued.
    await expect(server.mutation(api.activity.deleteComment, { userId: moderator, commentId: first })).rejects.toThrow(
      "isn't yours",
    );
    await server.mutation(api.activity.deleteComment, { userId: fan, commentId: first });
    await server.mutation(api.activity.deleteComment, { userId: owner, commentId: second });
    await server.mutation(api.activity.deleteComment, { userId: admin, commentId: third });
    // Gone, or never an id at all: nothing to do.
    await server.mutation(api.activity.deleteComment, { userId: fan, commentId: first });
    await server.mutation(api.activity.deleteComment, { userId: fan, commentId: "not-an-id" });
    expect((await server.query(api.slops.getForServer, { slopId }))?.commentCount).toBe(0);
  });

  it("refuses feedback on hidden slops", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const fan = await makeUser(server, "fan");
    const admin = await makeStaff(t, server, "ada", "admin");
    const { slopId } = await ship(server, owner, "2026-10-06");
    await server.mutation(api.slops.setHidden, { adminId: admin, slopId, hidden: true });
    await expect(
      server.mutation(api.activity.addComment, { userId: fan, slopId, kind: "feedback", body: "Hello?" }),
    ).rejects.toThrow("Slop not found");
  });
});

describe("signing in the CLI from the browser", () => {
  const login = { deviceCodeHash: "device-hash", userCode: "BCDF-GHJK", name: "slopper CLI on studio" };
  const token = { deviceCodeHash: "device-hash", hash: "token-hash", preview: "slp_abcdef" };

  it("hands one token to the CLI once its person approves, and only the server takes part", async () => {
    const { t, server } = setup();
    const userId = await makeUser(server, "ifiok");
    await expect(t.mutation(api.cliLogins.start, login)).rejects.toThrow("Only the Slopper server");
    const { expiresAt } = await server.mutation(api.cliLogins.start, login);
    expect(expiresAt - Date.now()).toBeGreaterThan(9 * 60_000);

    expect(await server.mutation(api.cliLogins.collect, token)).toEqual({ status: "pending" });
    expect(await server.query(api.cliLogins.lookup, { userCode: "BCDF-GHJK" })).toMatchObject({
      name: "slopper CLI on studio",
      status: "pending",
    });
    expect(await server.mutation(api.cliLogins.decide, { userId, userCode: "BCDF-GHJK", approve: true })).toEqual({
      decided: true,
    });
    // Decided once: a second click changes nothing.
    expect(await server.mutation(api.cliLogins.decide, { userId, userCode: "BCDF-GHJK", approve: false })).toEqual({
      decided: false,
    });

    expect(await server.mutation(api.cliLogins.collect, token)).toEqual({ status: "approved", username: "ifiok" });
    expect(await server.query(api.tokens.list, { userId })).toMatchObject([
      { name: "slopper CLI on studio", preview: "slp_abcdef" },
    ]);
    expect(await server.mutation(api.tokens.use, { hash: "token-hash" })).toMatchObject({ _id: userId });
    // Spent: polling again gets nothing more.
    expect(await server.mutation(api.cliLogins.collect, token)).toEqual({ status: "expired" });
    expect(await server.query(api.cliLogins.lookup, { userCode: "BCDF-GHJK" })).toMatchObject({ status: "used" });
  });

  it("gives a denied or expired login nothing", async () => {
    const { t, server } = setup();
    const userId = await makeUser(server, "ifiok");
    await server.mutation(api.cliLogins.start, login);
    await server.mutation(api.cliLogins.decide, { userId, userCode: "BCDF-GHJK", approve: false });
    expect(await server.mutation(api.cliLogins.collect, token)).toEqual({ status: "denied" });

    await server.mutation(api.cliLogins.start, { ...login, deviceCodeHash: "late-hash", userCode: "LMNP-QRST" });
    await t.run(async (ctx) => {
      const late = await ctx.db
        .query("cliLogins")
        .withIndex("by_user_code", (q) => q.eq("userCode", "LMNP-QRST"))
        .unique();
      if (late) await ctx.db.patch(late._id, { expiresAt: Date.now() - 1 });
    });
    expect(await server.mutation(api.cliLogins.decide, { userId, userCode: "LMNP-QRST", approve: true })).toEqual({
      decided: false,
    });
    expect(await server.mutation(api.cliLogins.collect, { ...token, deviceCodeHash: "late-hash" })).toEqual({
      status: "expired",
    });
    expect(await server.mutation(api.cliLogins.collect, { ...token, deviceCodeHash: "unknown" })).toEqual({
      status: "expired",
    });
    expect(await server.query(api.tokens.list, { userId })).toEqual([]);
  });

  it("replaces the token a machine had before, and never reuses a live user code", async () => {
    const { server } = setup();
    const userId = await makeUser(server, "ifiok");
    const old = { userId, preview: "slp_old", hash: "old-hash" };
    await server.mutation(api.tokens.create, { ...old, name: "slopper CLI on studio" });
    await server.mutation(api.tokens.create, { ...old, name: "Laptop", hash: "laptop-hash" });

    await server.mutation(api.cliLogins.start, login);
    await expect(server.mutation(api.cliLogins.start, { ...login, deviceCodeHash: "other" })).rejects.toThrow(
      "That user code is taken.",
    );
    await server.mutation(api.cliLogins.decide, { userId, userCode: "BCDF-GHJK", approve: true });
    await server.mutation(api.cliLogins.collect, token);

    const tokens = await server.query(api.tokens.list, { userId });
    expect(tokens.map(({ name, preview }) => ({ name, preview }))).toEqual(
      expect.arrayContaining([
        { name: "Laptop", preview: "slp_old" },
        { name: "slopper CLI on studio", preview: "slp_abcdef" },
      ]),
    );
    expect(tokens).toHaveLength(2);
    expect(await server.mutation(api.tokens.use, { hash: "old-hash" })).toBeNull();
  });
});

describe("the moderation team", () => {
  it("bootstraps admins by sign-in account, and only admins change roles", async () => {
    const { t, server } = setup();
    const ifiok = await makeUser(server, "ifiokjr");
    const newcomer = await makeUser(server, "newcomer");
    const listed = { provider: "dev", providerId: "ifiokjr" };
    // An account nobody signs in with yet makes nobody an admin.
    await server.mutation(api.team.bootstrap, { provider: "github", providerId: "1160934" });
    expect(await server.query(api.team.members, {})).toEqual([]);
    await server.mutation(api.team.bootstrap, listed);
    // Running it again changes nothing.
    await server.mutation(api.team.bootstrap, listed);
    expect(await server.query(api.team.members, {})).toMatchObject([{ username: "ifiokjr", role: "admin" }]);
    expect(await server.query(api.team.log, {})).toMatchObject([
      { actor: "ifiokjr", action: { type: "listedAdmin", userId: ifiok }, target: "@ifiokjr" },
    ]);
    // The account stays listed whatever its username becomes.
    await t.run(async (ctx) => await ctx.db.patch(ifiok, { username: "ifiok" }));
    expect(
      await server.query(api.team.listed, { identities: [listed, { provider: "github", providerId: "1160934" }] }),
    ).toEqual([{ id: ifiok, username: "ifiok" }]);
    await expect(t.query(api.team.listed, { identities: [listed] })).rejects.toThrow("Only the Slopper server");
    await expect(t.mutation(api.team.bootstrap, listed)).rejects.toThrow("Only the Slopper server");
    await t.run(async (ctx) => await ctx.db.patch(ifiok, { username: "ifiokjr" }));

    expect(
      await server.mutation(api.team.setRole, { adminId: ifiok, username: "@NewComer", role: "moderator" }),
    ).toMatchObject({ username: "newcomer", role: "moderator" });
    // A moderator works the queues; the team is for admins.
    await expect(
      server.mutation(api.team.setRole, { adminId: newcomer, username: "ifiokjr", role: null }),
    ).rejects.toThrow("Only admins can do that.");
    await expect(
      server.mutation(api.team.setRole, { adminId: ifiok, username: "nobody", role: "moderator" }),
    ).rejects.toThrow("There's no account with that username.");
    await expect(t.mutation(api.team.setRole, { adminId: ifiok, username: "newcomer", role: null })).rejects.toThrow(
      "Only the Slopper server",
    );
    await expect(t.query(api.team.members, {})).rejects.toThrow("Only the Slopper server");
    expect((await server.query(api.team.members, {})).map((member) => [member.username, member.role])).toEqual([
      ["ifiokjr", "admin"],
      ["newcomer", "moderator"],
    ]);
  });

  it("never removes the last admin", async () => {
    const { server } = setup();
    const first = await makeUser(server, "first");
    await makeUser(server, "second");
    await server.mutation(api.team.bootstrap, { provider: "dev", providerId: "first" });

    await expect(server.mutation(api.team.setRole, { adminId: first, username: "first", role: null })).rejects.toThrow(
      "Slopper needs at least one admin.",
    );
    await expect(
      server.mutation(api.team.setRole, { adminId: first, username: "first", role: "moderator" }),
    ).rejects.toThrow("Slopper needs at least one admin.");

    await server.mutation(api.team.setRole, { adminId: first, username: "second", role: "admin" });
    expect(await server.mutation(api.team.setRole, { adminId: first, username: "first", role: null })).toMatchObject({
      role: null,
    });
    // Now first is off the team, so they can't change anything.
    await expect(
      server.mutation(api.team.setRole, { adminId: first, username: "first", role: "admin" }),
    ).rejects.toThrow("Only admins can do that.");
    await expect(
      server.mutation(api.team.setRole, {
        adminId: (await server.query(api.team.members, {}))[0].id,
        username: "second",
        role: null,
      }),
    ).rejects.toThrow("Slopper needs at least one admin.");
  });

  it("finds accounts by the start of their username", async () => {
    const { server } = setup();
    for (const name of ["maya", "mayday", "marco"]) await makeUser(server, name);
    const names = async (prefix: string) =>
      (await server.query(api.team.search, { prefix })).map((member) => member.username);
    expect(await names("@MAY")).toEqual(["maya", "mayday"]);
    expect(await names("ma")).toEqual(["marco", "maya", "mayday"]);
    expect(await names("  ")).toEqual([]);
    expect(await names("zz")).toEqual([]);
  });

  it("lets moderators see hidden slops, and keeps roles out of public shapes", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const visitor = await makeUser(server, "visitor");
    const moderator = await makeStaff(t, server, "mia", "moderator");
    const admin = await makeStaff(t, server, "ada", "admin");
    const { slopId } = await ship(server, owner, "2026-10-17");
    await expect(server.mutation(api.slops.setHidden, { adminId: moderator, slopId, hidden: true })).rejects.toThrow(
      "Only admins can do that.",
    );
    await server.mutation(api.slops.setHidden, { adminId: admin, slopId, hidden: true });

    const page = (asUser: Id<"users">) => server.query(api.slops.page, { username: "owner", slug: "tiltmaze", asUser });
    expect(await page(visitor)).toBeNull();
    // Nor does the live query in a visitor's browser.
    expect(
      await t.withIdentity({ subject: visitor }).query(api.slops.page, { username: "owner", slug: "tiltmaze" }),
    ).toBeNull();
    expect((await page(moderator))?.slop.hidden).toBe(true);
    // The live query in a moderator's browser sees it too.
    expect(
      (await t.withIdentity({ subject: moderator }).query(api.slops.page, { username: "owner", slug: "tiltmaze" }))
        ?.slop.hidden,
    ).toBe(true);

    // Only the owner and admins delete a slop; moderators can't.
    await expect(server.mutation(api.slops.remove, { slopId, byUserId: moderator })).rejects.toThrow(
      "That slop isn't yours.",
    );
    const profile = await server.query(api.users.profile, { username: "ada" });
    expect(profile?.owner).not.toHaveProperty("role");
    await server.mutation(api.slops.remove, { slopId, byUserId: admin });
    expect(await server.query(api.slops.getForServer, { slopId })).toBeNull();
  });

  it("gives each role its permissions, and nobody else any", async () => {
    const { t, server } = setup();
    const ids = [
      await makeUser(server, "visitor"),
      await makeStaff(t, server, "mia", "moderator"),
      await makeStaff(t, server, "ada", "admin"),
    ];
    const [visitor, moderator, admin] = await t.run(async (ctx) => await Promise.all(ids.map((id) => ctx.db.get(id))));
    expect(permissionsOf(null)).toEqual([]);
    expect(permissionsOf(visitor)).toEqual([]);
    expect(permissionsOf(moderator).sort()).toEqual(["queue.decide", "slops.viewHidden"]);
    expect(permissionsOf(admin).sort()).toEqual([
      "analytics.manage",
      "analytics.view",
      "comments.deleteAny",
      "queue.decide",
      "queue.decideOwn",
      "reviews.deleteAny",
      "slops.deleteAny",
      "slops.hide",
      "slops.viewHidden",
      "team.manage",
      "videos.takeDown",
      "videos.trust",
    ]);
    expect(can(moderator, "slops.viewHidden")).toBe(true);
    expect(can(moderator, "slops.hide")).toBe(false);
    // Analytics are admins' alone.
    expect(can(moderator, "analytics.view")).toBe(false);
    expect(can(visitor, "queue.decide")).toBe(false);
  });

  it("leaves a moderator's own flagged slop to someone else", async () => {
    const { t, server } = setup();
    const moderator = await makeStaff(t, server, "mia", "moderator");
    const admin = await makeStaff(t, server, "ada", "admin");
    const flagger = await makeUser(server, "flagger");
    const { slopId } = await ship(server, moderator, "2026-10-17");
    await server.mutation(api.moderation.flag, { userId: flagger, slopId, reason: "Spam" });
    await server.mutation(api.slops.setHidden, { adminId: admin, slopId, hidden: true });
    await server.mutation(api.moderation.flag, { userId: flagger, slopId, reason: "Spam" });

    // Clearing their own flags would unhide it and restart its auto-posts.
    await expect(
      server.mutation(api.moderation.decide, { moderatorId: moderator, slopId, decision: "fine" }),
    ).rejects.toThrow("That's your slop, so another moderator decides on it.");
    expect(await server.query(api.moderation.queue, {})).toMatchObject([{ id: slopId, ownerId: moderator }]);
    // Admins may: they can unhide any slop anyway.
    await server.mutation(api.moderation.decide, { moderatorId: admin, slopId, decision: "fine" });
    expect(await server.query(api.moderation.queue, {})).toEqual([]);
    expect((await server.query(api.slops.getForServer, { slopId }))?.hidden).toBe(false);
  });

  it("logs every use of a staff power, and nothing else", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const fan = await makeUser(server, "fan");
    const helper = await makeUser(server, "helper");
    const admin = await makeStaff(t, server, "ada", "admin");
    const { slopId } = await ship(server, owner, "2026-10-17");
    const mine = await server.mutation(api.slops.create, {
      userId: fan,
      input: { ...input, name: "Fan Game" },
      launchNote: "Mine",
      today: "2026-10-17",
    });

    await server.mutation(api.team.setRole, { adminId: admin, username: "helper", role: "moderator" });
    // Setting the role someone already has changes nothing, so it isn't logged.
    await server.mutation(api.team.setRole, { adminId: admin, username: "helper", role: "moderator" });
    await server.mutation(api.moderation.flag, { userId: fan, slopId, reason: "Spam" });
    await server.mutation(api.moderation.decide, { moderatorId: helper, slopId, decision: "nsfw" });
    await server.mutation(api.slops.setHidden, { adminId: admin, slopId, hidden: true });
    await server.mutation(api.slops.setHidden, { adminId: admin, slopId, hidden: false });
    const commentId = await server.mutation(api.activity.addComment, {
      userId: fan,
      slopId,
      kind: "feedback",
      body: "Nice.",
    });
    await server.mutation(api.activity.deleteComment, { userId: admin, commentId });
    // Owners deleting their own slops are no staff business.
    await server.mutation(api.slops.remove, { slopId: mine.slopId, byUserId: fan });
    await server.mutation(api.slops.remove, { slopId, byUserId: admin });

    const log = await server.query(api.team.log, {});
    expect(log.map(({ actor, action, target }) => ({ actor, action, target }))).toEqual([
      { actor: "ada", action: { type: "deleteSlop", slopId, ownerId: owner }, target: "TiltMaze" },
      { actor: "ada", action: { type: "deleteComment", slopId, authorId: fan }, target: "TiltMaze" },
      { actor: "ada", action: { type: "hidden", slopId, hidden: false }, target: "TiltMaze" },
      { actor: "ada", action: { type: "hidden", slopId, hidden: true }, target: "TiltMaze" },
      { actor: "helper", action: { type: "flags", slopId, decision: "nsfw" }, target: "TiltMaze" },
      { actor: "ada", action: { type: "role", userId: helper, role: "moderator" }, target: "@helper" },
    ]);
    // It never leaves the server.
    await expect(t.query(api.team.log, {})).rejects.toThrow("Only the Slopper server");
    await expect(t.withIdentity({ subject: admin }).query(api.team.log, {})).rejects.toThrow("Only the Slopper server");
  });
});

describe("promo videos", () => {
  async function upload(t: ReturnType<typeof setup>["t"], server: Server, ownerId: Id<"users">, contentType: string) {
    const storageId = await t.run(async (ctx) => await ctx.storage.store(new Blob([new Uint8Array([0, 0, 0, 24])])));
    const { mediaId } = await server.mutation(api.media.register, {
      ownerId,
      location: { backend: "convex", storageId },
      contentType,
      size: 4,
      check: { verdict: "unchecked", reason: "test" },
    });
    return mediaId;
  }

  const checker = { model: "google/gemini-3.1-flash-lite", provider: "google-ai-studio" };

  it("waits for a moderator before anyone can watch it, and never passes for a screenshot", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const other = await makeUser(server, "other");
    const moderator = await makeStaff(t, server, "mia", "moderator");
    const { slopId } = await ship(server, owner, "2026-10-17");
    const video = await upload(t, server, owner, "video/mp4");
    const image = await upload(t, server, owner, "image/png");
    const theirs = await upload(t, server, other, "video/mp4");
    const setVideo = (mediaId: string | null) => server.mutation(api.videos.set, { userId: owner, slopId, mediaId });

    await expect(setVideo(image)).rejects.toThrow("That isn't one of your uploaded videos.");
    await expect(setVideo(theirs)).rejects.toThrow("That isn't one of your uploaded videos.");
    // Not trusted yet, so nothing for the video check.
    expect(await setVideo(video)).toEqual({ status: "pending", orphaned: 0, check: null });

    const page = () => server.query(api.slops.page, { username: "owner", slug: "tiltmaze", asUser: other });
    expect((await page())?.slop).toMatchObject({ video: null, videoPending: true });
    expect(await server.query(api.videos.queue, {})).toMatchObject([
      { slopId, mediaId: video, name: "TiltMaze", owner: "owner", trust: null, check: null },
    ]);

    // A video id sent as a screenshot is dropped, not shown unreviewed.
    await server.mutation(api.slops.edit, { userId: owner, slopId, input: { ...input, screenshots: [video] } });
    expect((await page())?.slop.screenshots).toEqual([]);

    const decide = (moderatorId: Id<"users">, mediaId: Id<"media">) =>
      server.mutation(api.videos.decide, { moderatorId, slopId, mediaId, approve: true });
    await expect(decide(other, video)).rejects.toThrow("Only moderators can do that.");
    // Only the video the moderator watched.
    expect(await decide(moderator, theirs)).toEqual({ decided: false, newlyTrusted: false, orphaned: 0 });
    expect(await decide(moderator, video)).toEqual({ decided: true, newlyTrusted: true, orphaned: 0 });
    expect((await page())?.slop).toMatchObject({ video: expect.stringMatching(/^https?:\/\//), videoPending: false });
    expect(await server.query(api.videos.queue, {})).toEqual([]);
    expect(await decide(moderator, video)).toEqual({ decided: false, newlyTrusted: false, orphaned: 0 });
    expect(await server.query(api.videos.trustList, {})).toMatchObject([
      { userId: owner, username: "owner", trusted: true, by: "mia" },
    ]);
  });

  it("leaves a moderator's own video to someone else, so nobody trusts themselves", async () => {
    const { t, server } = setup();
    const moderator = await makeStaff(t, server, "mia", "moderator");
    const admin = await makeStaff(t, server, "ada", "admin");
    const { slopId } = await ship(server, moderator, "2026-10-17");
    const video = await upload(t, server, moderator, "video/mp4");
    await server.mutation(api.videos.set, { userId: moderator, slopId, mediaId: video });

    await expect(
      server.mutation(api.videos.decide, { moderatorId: moderator, slopId, mediaId: video, approve: true }),
    ).rejects.toThrow("That's your slop, so another moderator decides on it.");
    expect(await server.query(api.videos.queue, {})).toMatchObject([{ slopId, ownerId: moderator }]);
    expect(await server.query(api.videos.trustList, {})).toEqual([]);

    expect(
      await server.mutation(api.videos.decide, { moderatorId: admin, slopId, mediaId: video, approve: true }),
    ).toMatchObject({ decided: true, newlyTrusted: true });
    await server.mutation(api.videos.takeDown, { adminId: admin, slopId, mediaId: video });
    await server.mutation(api.videos.setTrust, { adminId: admin, userId: moderator, trusted: false });
    expect(
      (await server.query(api.team.log, {})).map(({ actor, action, target }) => ({ actor, action, target })),
    ).toEqual([
      { actor: "ada", action: { type: "trust", userId: moderator, trusted: false }, target: "@mia" },
      { actor: "ada", action: { type: "takeDown", slopId }, target: "TiltMaze" },
      { actor: "ada", action: { type: "video", slopId, approved: true }, target: "TiltMaze" },
    ]);
  });

  it("lets go of a replaced or removed video, and only the server takes part", async () => {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const moderator = await makeStaff(t, server, "mia", "moderator");
    const { slopId } = await ship(server, owner, "2026-10-17");
    const first = await upload(t, server, owner, "video/mp4");
    const second = await upload(t, server, owner, "video/webm");
    await expect(t.mutation(api.videos.set, { userId: owner, slopId, mediaId: first })).rejects.toThrow(
      "Only the Slopper server",
    );

    await server.mutation(api.videos.set, { userId: owner, slopId, mediaId: first });
    await server.mutation(api.videos.set, { userId: owner, slopId, mediaId: second });
    // Convex-stored media goes at once; the first video is gone, and only the second waits for review.
    expect(await t.run(async (ctx) => await ctx.db.get(first))).toBeNull();
    expect(await server.query(api.videos.queue, {})).toHaveLength(1);

    expect(
      await server.mutation(api.videos.decide, { moderatorId: moderator, slopId, mediaId: second, approve: false }),
    ).toEqual({ decided: true, newlyTrusted: false, orphaned: 0 });
    expect(await t.run(async (ctx) => await ctx.db.get(second))).toBeNull();
    const slop = await t.run(async (ctx) => await ctx.db.get(slopId));
    expect(slop?.video).toBeUndefined();
    // Taking a video off trusts nobody.
    expect(await server.query(api.videos.trustList, {})).toEqual([]);
    expect(await server.mutation(api.videos.set, { userId: owner, slopId, mediaId: null })).toEqual({
      status: "none",
      orphaned: 0,
      check: null,
    });
  });

  /** A maker with one approved video, so trusted, and a second slop to put new ones on. */
  async function trustedMaker() {
    const { t, server } = setup();
    const owner = await makeUser(server, "owner");
    const other = await makeUser(server, "other");
    const moderator = await makeStaff(t, server, "mia", "moderator");
    const admin = await makeStaff(t, server, "ada", "admin");
    const first = await ship(server, owner, "2026-10-16");
    const approved = await upload(t, server, owner, "video/mp4");
    await server.mutation(api.videos.set, { userId: owner, slopId: first.slopId, mediaId: approved });
    await server.mutation(api.videos.decide, {
      moderatorId: moderator,
      slopId: first.slopId,
      mediaId: approved,
      approve: true,
    });
    const { slopId } = await server.mutation(api.slops.create, {
      userId: owner,
      input: { ...input, name: "TiltMaze 2" },
      launchNote: "Day 2",
      today: "2026-10-17",
    });
    const page = () => server.query(api.slops.page, { username: "owner", slug: "tiltmaze-2", asUser: other });
    const setVideo = async () => {
      const mediaId = await upload(t, server, owner, "video/webm");
      return { mediaId, ...(await server.mutation(api.videos.set, { userId: owner, slopId, mediaId })) };
    };
    return { t, server, owner, other, moderator, admin, slopId, approved, page, setVideo };
  }

  it("plays a trusted maker's video at once when the check passes it", async () => {
    const { t, server, slopId, page, setVideo } = await trustedMaker();
    const { mediaId, status, check } = await setVideo();
    // It waits like any video until the check answers.
    expect(status).toBe("pending");
    expect(check).toEqual({ mediaId, url: expect.stringMatching(/^https?:\/\//), contentType: "video/webm" });
    expect((await page())?.slop.video).toBeNull();

    expect(
      await server.mutation(api.videos.recordCheck, {
        slopId,
        mediaId,
        verdict: "ok",
        reason: "A maze game.",
        checker,
      }),
    ).toEqual({ status: "live" });
    expect((await page())?.slop).toMatchObject({ video: expect.stringMatching(/^https?:\/\//), videoPending: false });
    expect(await server.query(api.videos.queue, {})).toEqual([]);
    expect(await server.query(api.videos.checks, {})).toMatchObject([
      {
        slopId,
        mediaId,
        owner: "owner",
        verdict: "ok",
        reason: "A maze game.",
        checker,
        outcome: "live",
        showing: "live",
      },
    ]);
    // Only the server records a check, and none of it reaches the public page.
    await expect(
      t.mutation(api.videos.recordCheck, { slopId, mediaId, verdict: "ok", reason: "Sneaky.", checker }),
    ).rejects.toThrow("Only the Slopper server");
    await expect(t.query(api.videos.checks, {})).rejects.toThrow("Only the Slopper server");
    expect(JSON.stringify(await page())).not.toContain("A maze game.");
  });

  it("leaves a trusted maker's video for a moderator when the check doesn't pass it", async () => {
    const { server, moderator, slopId, page, setVideo } = await trustedMaker();
    const mature = await setVideo();
    expect(
      await server.mutation(api.videos.recordCheck, {
        slopId,
        mediaId: mature.mediaId,
        verdict: "mature",
        reason: "Strong language.",
        checker,
      }),
    ).toEqual({ status: "pending" });
    expect((await page())?.slop).toMatchObject({ video: null, videoPending: true });
    expect(await server.query(api.videos.queue, {})).toMatchObject([
      {
        slopId,
        mediaId: mature.mediaId,
        trust: "trusted",
        check: { verdict: "mature", reason: "Strong language.", checker },
      },
    ]);

    // A check that couldn't run, with no check configured at all, falls back the same way.
    const unchecked = await setVideo();
    expect(
      await server.mutation(api.videos.recordCheck, {
        slopId,
        mediaId: unchecked.mediaId,
        verdict: "unchecked",
        reason: "No video check is configured.",
        checker: null,
      }),
    ).toEqual({ status: "pending" });
    expect((await server.query(api.videos.checks, {})).map((row) => [row.verdict, row.outcome, row.showing])).toEqual([
      ["unchecked", "queued", "pending"],
      ["mature", "queued", "gone"],
    ]);

    // An answer about a video replaced since is skipped: the replacement gets its own check.
    expect(
      await server.mutation(api.videos.recordCheck, {
        slopId,
        mediaId: mature.mediaId,
        verdict: "ok",
        reason: "Late.",
        checker,
      }),
    ).toEqual({ status: "pending" });
    expect(await server.query(api.videos.checks, {})).toHaveLength(2);

    // The moderator still decides as usual.
    expect(
      await server.mutation(api.videos.decide, {
        moderatorId: moderator,
        slopId,
        mediaId: unchecked.mediaId,
        approve: true,
      }),
    ).toEqual({ decided: true, newlyTrusted: false, orphaned: 0 });
  });

  it("lets admins revoke trust, take down what the check let through, and give trust back", async () => {
    const { server, owner, moderator, admin, slopId, page, setVideo } = await trustedMaker();
    const passed = await setVideo();
    await server.mutation(api.videos.recordCheck, {
      slopId,
      mediaId: passed.mediaId,
      verdict: "ok",
      reason: "Fine.",
      checker,
    });

    // Moderators only approve or reject what's queued.
    await expect(
      server.mutation(api.videos.takeDown, { adminId: moderator, slopId, mediaId: passed.mediaId }),
    ).rejects.toThrow("Only admins can do that.");
    await expect(
      server.mutation(api.videos.setTrust, { adminId: moderator, userId: owner, trusted: false }),
    ).rejects.toThrow("Only admins can do that.");
    expect(await server.mutation(api.videos.takeDown, { adminId: admin, slopId, mediaId: passed.mediaId })).toEqual({
      removed: true,
      orphaned: 0,
    });
    expect((await page())?.slop).toMatchObject({ video: null, videoPending: false });
    expect(await server.mutation(api.videos.setTrust, { adminId: admin, userId: owner, trusted: false })).toBe("owner");

    // Revoked: no check, and approving a video doesn't trust them again.
    const waiting = await setVideo();
    expect(waiting.check).toBeNull();
    expect(
      await server.mutation(api.videos.recordCheck, {
        slopId,
        mediaId: waiting.mediaId,
        verdict: "ok",
        reason: "Raced the revoke.",
        checker,
      }),
    ).toEqual({ status: "pending" });
    expect(await server.query(api.videos.queue, {})).toMatchObject([{ mediaId: waiting.mediaId, trust: "revoked" }]);
    expect(
      await server.mutation(api.videos.decide, {
        moderatorId: moderator,
        slopId,
        mediaId: waiting.mediaId,
        approve: true,
      }),
    ).toEqual({ decided: true, newlyTrusted: false, orphaned: 0 });
    expect((await setVideo()).check).toBeNull();
    expect(await server.query(api.videos.trustList, {})).toMatchObject([
      { username: "owner", trusted: false, by: "ada" },
    ]);

    await server.mutation(api.videos.setTrust, { adminId: admin, userId: owner, trusted: true });
    expect((await setVideo()).check).not.toBeNull();
  });
});
