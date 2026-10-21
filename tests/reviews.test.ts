// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ConvexCaller } from "~/.server/convex";
import { validateReview } from "~/.server/forms";
import type { ContentCheck, Submission } from "~/.server/moderation";
import { BLOCKED_REVIEW, postReview } from "~/.server/reviews";
import { convexApp } from "./convexApp";

const MEDIA_URL = "https://media.test/file/slopper-media";

function setup() {
  vi.stubEnv("MEDIA_PUBLIC_URL", MEDIA_URL);
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Setup = ReturnType<typeof setup>;

async function makeUser({ server }: Setup, name: string): Promise<Id<"users">> {
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

async function ship({ server }: Setup, userId: Id<"users">): Promise<Id<"slops">> {
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

/** A B2 image row, as `uploadImage` would register it. */
async function image({ t }: Setup, ownerId: Id<"users">, key: string, verdict: "ok" | "mature" = "ok") {
  return await t.run(
    async (ctx) =>
      await ctx.db.insert("media", {
        ownerId,
        contentType: "image/png",
        size: 10,
        check: { verdict, reason: `Looks ${verdict}.` },
        backend: "b2",
        key,
      }),
  );
}

async function page({ server }: Setup, asUser?: Id<"users">) {
  const result = await server.query(api.slops.page, { username: "maker", slug: "tiltmaze", asUser });
  if (!result) throw new Error("No page");
  return result;
}

const OK = { verdict: "ok", reason: "A fair review." } as const;

async function world() {
  const setup_ = setup();
  const maker = await makeUser(setup_, "maker");
  const tester = await makeUser(setup_, "tester");
  const slopId = await ship(setup_, maker);
  return { ...setup_, maker, tester, slopId };
}

describe("reviews", () => {
  it("go up at once with the reviewer's own screenshots, and tell the maker", async () => {
    const w = await world();
    const mine = await image(w, w.tester, "reviews/mine.png");
    const theirs = await image(w, w.maker, "reviews/theirs.png");
    const saved = await w.server.mutation(api.reviews.save, {
      userId: w.tester,
      slopId: w.slopId,
      experience: "broken",
      body: "Crashes when I **tilt left**.",
      images: [mine, theirs, "not-an-id"],
      check: OK,
    });
    expect(saved).toMatchObject({ created: true, orphaned: 0 });

    const seen = await page(w);
    expect(seen.reviews).toHaveLength(1);
    expect(seen.reviews[0]).toMatchObject({
      experience: "broken",
      images: [`${MEDIA_URL}/reviews/mine.png`],
      mature: false,
      blur: false,
      canDelete: false,
      author: { username: "tester" },
    });
    expect(seen.reviews[0].html).toContain("<strong>tilt left</strong>");
    expect(seen.mine).toBeNull();
    expect((await page(w, w.tester)).mine).toMatchObject({
      experience: "broken",
      body: "Crashes when I **tilt left**.",
      images: [{ id: mine, url: `${MEDIA_URL}/reviews/mine.png` }],
    });

    const asMaker = w.t.withIdentity({ subject: w.maker });
    expect((await asMaker.query(api.notifications.mine, {})).map((item) => item.kind)).toContain("review");
    // The check's reason stays in Convex.
    expect(JSON.stringify(seen.reviews)).not.toContain("A fair review");
  });

  it("aren't for the maker's own slop, or a hidden one", async () => {
    const w = await world();
    const review = { experience: "works" as const, body: "Love it", images: [], check: OK };
    await expect(w.server.mutation(api.reviews.save, { ...review, userId: w.maker, slopId: w.slopId })).rejects.toThrow(
      "You can't review your own slop",
    );
    await w.t.run(async (ctx) => await ctx.db.patch(w.slopId, { hidden: true }));
    await expect(
      w.server.mutation(api.reviews.save, { ...review, userId: w.tester, slopId: w.slopId }),
    ).rejects.toThrow("Slop not found.");
    await expect(w.server.mutation(api.reviews.save, { ...review, userId: w.tester, slopId: "nope" })).rejects.toThrow(
      "Slop not found.",
    );
  });

  it("replace the reviewer's earlier one and let go of screenshots it dropped", async () => {
    const w = await world();
    const first = await image(w, w.tester, "reviews/first.png");
    const second = await image(w, w.tester, "reviews/second.png");
    const base = { userId: w.tester, slopId: w.slopId, check: OK } as const;
    const { reviewId } = await w.server.mutation(api.reviews.save, {
      ...base,
      experience: "broken",
      body: "Crashes",
      images: [first],
    });
    const again = await w.server.mutation(api.reviews.save, {
      ...base,
      experience: "works",
      body: "Fixed now!",
      images: [second],
    });
    expect(again).toEqual({ reviewId, created: false, orphaned: 1 });
    const seen = await page(w);
    expect(seen.reviews).toHaveLength(1);
    expect(seen.reviews[0]).toMatchObject({ experience: "works", images: [`${MEDIA_URL}/reviews/second.png`] });
    expect(seen.reviews[0].editedAt).not.toBeNull();
    expect(await w.t.run(async (ctx) => (await ctx.db.get(first))?.orphanedAt)).toBeTypeOf("number");
  });

  it("are mature when the check says so or a screenshot is, and blurred for people who haven't opted in", async () => {
    const w = await world();
    const reader = await makeUser(w, "reader");
    const spicy = await image(w, w.tester, "reviews/spicy.png", "mature");
    await w.server.mutation(api.reviews.save, {
      userId: w.tester,
      slopId: w.slopId,
      experience: "mixed",
      body: "Works, but the art is a lot.",
      images: [spicy],
      check: OK,
    });
    expect((await page(w, reader)).reviews[0]).toMatchObject({ mature: true, blur: true });
    expect((await page(w, w.tester)).reviews[0]).toMatchObject({ mature: true, blur: false });
    await w.t.run(async (ctx) => await ctx.db.patch(reader, { showNsfw: true }));
    expect((await page(w, reader)).reviews[0].blur).toBe(false);
  });

  it("can be deleted by their author or an admin, never the maker", async () => {
    const w = await world();
    const admin = await makeUser(w, "boss");
    await w.t.run(async (ctx) => await ctx.db.patch(admin, { role: "admin" }));
    const write = async () =>
      await w.server.mutation(api.reviews.save, {
        userId: w.tester,
        slopId: w.slopId,
        experience: "broken",
        body: "Nope",
        images: [],
        check: OK,
      });

    const { reviewId } = await write();
    expect((await page(w, w.maker)).reviews[0].canDelete).toBe(false);
    await expect(w.server.mutation(api.reviews.remove, { userId: w.maker, reviewId })).rejects.toThrow(
      "That isn't yours to delete.",
    );
    expect((await page(w, admin)).reviews[0].canDelete).toBe(true);
    await w.server.mutation(api.reviews.remove, { userId: admin, reviewId });
    expect((await page(w)).reviews).toHaveLength(0);
    const log = await w.t.run(async (ctx) => await ctx.db.query("staffActions").collect());
    expect(log.map((entry) => [entry.action.type, entry.target])).toEqual([["deleteReview", "TiltMaze"]]);

    const again = await write();
    await w.server.mutation(api.reviews.remove, { userId: w.tester, reviewId: again.reviewId });
    expect((await page(w)).reviews).toHaveLength(0);
  });

  it("go with their slop, and keep the screenshots they show", async () => {
    const w = await world();
    const shot = await image(w, w.tester, "reviews/shot.png");
    await w.server.mutation(api.reviews.save, {
      userId: w.tester,
      slopId: w.slopId,
      experience: "works",
      body: "Nice",
      images: [shot],
      check: OK,
    });
    // The reviewer's own launch lets go of nothing a review still shows.
    const own = await w.server.mutation(api.slops.create, {
      userId: w.tester,
      input: {
        name: "Other",
        tagline: "Mine",
        description: "",
        category: "games",
        links: [{ kind: "website", url: "https://other.app/" }],
        screenshots: [shot],
        madeWith: [],
      },
      launchNote: "",
    });
    expect(await w.server.mutation(api.slops.remove, { slopId: own.slopId, byUserId: w.tester })).toEqual({
      orphaned: 0,
    });

    expect(await w.server.mutation(api.slops.remove, { slopId: w.slopId, byUserId: w.maker })).toEqual({
      orphaned: 1,
    });
    expect(await w.t.run(async (ctx) => await ctx.db.query("reviews").collect())).toEqual([]);
  });

  it("are listed for agents with their Markdown", async () => {
    const w = await world();
    await w.server.mutation(api.reviews.save, {
      userId: w.tester,
      slopId: w.slopId,
      experience: "works",
      body: "Works **great**",
      images: [],
      check: OK,
    });
    const listed = await w.server.query(api.reviews.listForServer, { slopId: w.slopId });
    expect(listed?.slop).toMatchObject({ name: "TiltMaze", username: "maker" });
    expect(listed?.reviews).toMatchObject([{ by: "tester", experience: "works", body: "Works **great**" }]);
    expect(await w.server.query(api.reviews.listForServer, { slopId: "nope" })).toBeNull();
  });
});

describe("postReview", () => {
  function services(verdict: ContentCheck | null) {
    const mutation = vi.fn(async () => ({ reviewId: "r1", created: true, orphaned: 0 }));
    const query = vi.fn(async () => "https://media.test/shot.png");
    const seen: Submission[] = [];
    return {
      mutation,
      seen,
      services: {
        convex: { query, mutation } as unknown as ConvexCaller,
        check: async (submission: Submission) => {
          seen.push(submission);
          return verdict;
        },
      },
    };
  }
  const slop = { id: "s1" as Id<"slops">, name: "TiltMaze" };
  const review = { experience: "broken", body: "It crashed.", images: ["k17abcdefghijklmnop"] } as const;

  it("checks the text and screenshots, then saves an ok review", async () => {
    const fake = services({ verdict: "ok", reason: "Fine." });
    expect(
      await postReview("u1" as Id<"users">, slop, { ...review, images: [...review.images] }, fake.services),
    ).toMatchObject({ ok: true, reviewId: "r1" });
    expect(fake.seen[0]).toEqual({
      fields: { reviewOf: "TiltMaze", experience: "Broken for me", review: "It crashed." },
      images: [{ url: "https://media.test/shot.png" }],
    });
    expect(fake.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ check: { verdict: "ok", reason: "Fine." } }),
    );
  });

  it("refuses a blocked review without saving it", async () => {
    const fake = services({ verdict: "blocked", reason: "Abuse." });
    expect(await postReview("u1" as Id<"users">, slop, { ...review, images: [] }, fake.services)).toEqual({
      ok: false,
      error: BLOCKED_REVIEW,
    });
    expect(fake.mutation).not.toHaveBeenCalled();
  });

  it("saves mature reviews as mature, and unchecked ones when the check can't run", async () => {
    const mature = services({ verdict: "mature", reason: "Crude." });
    await postReview("u1" as Id<"users">, slop, { ...review, images: [] }, mature.services);
    expect(mature.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ check: { verdict: "mature", reason: "Crude." } }),
    );
    const down = services(null);
    await postReview("u1" as Id<"users">, slop, { ...review, images: [] }, down.services);
    expect(down.mutation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ check: expect.objectContaining({ verdict: "unchecked" }) }),
    );
  });
});

describe("validateReview", () => {
  it("needs how it went and some words", () => {
    expect(validateReview({ experience: "great", body: "" })).toEqual({
      ok: false,
      errors: { experience: "Say how it went: works, mixed, broken.", body: "Say what you tried and how it went." },
    });
    expect(
      validateReview({ experience: "mixed", body: " Half works ", images: ["bad id", "k17abcdefghijklmnop"] }),
    ).toEqual({ ok: true, value: { experience: "mixed", body: "Half works", images: ["k17abcdefghijklmnop"] } });
    expect(validateReview({ experience: "works", body: "x".repeat(2001) }).ok).toBe(false);
  });
});
