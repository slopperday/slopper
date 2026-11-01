// @vitest-environment edge-runtime
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { FunctionReference } from "convex/server";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import type { ConvexCaller } from "~/.server/convex";
import type { ContentCheck, Submission } from "~/.server/moderation";
import { BLOCKED_COMMENT, postComment } from "~/.server/comments";
import { convexApp } from "./convexApp";
import { checkedLaunch } from "./launchFixtures";

function setup() {
  vi.stubEnv("COMMENTS_ENABLED", "true");
  const t = convexApp();
  return { t, server: t.withIdentity({ subject: "server" }) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

type Setup = ReturnType<typeof setup>;

/** The app server's line to Convex, answered by convex-test. */
function caller({ server }: Setup): ConvexCaller {
  return {
    query: async (query, ...args) => await server.query<FunctionReference<"query">>(query, ...args),
    mutation: async (mutation, ...args) => await server.mutation<FunctionReference<"mutation">>(mutation, ...args),
  };
}

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
  const { slopId } = await checkedLaunch(server, {
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

async function world() {
  const setup_ = setup();
  const maker = await makeUser(setup_, "maker");
  const fan = await makeUser(setup_, "fan");
  const moderator = await makeUser(setup_, "mia");
  await setup_.t.run(async (ctx) => await ctx.db.patch(moderator, { role: "moderator" }));
  const slopId = await ship(setup_, maker);
  const slop = { id: slopId, name: "TiltMaze" };
  const page = () => setup_.server.query(api.slops.page, { username: "maker", slug: "tiltmaze", withComments: true });
  return { ...setup_, maker, fan, moderator, slopId, slop, page };
}

describe("postComment", () => {
  it("refuses to start when Convex has comments switched off", async () => {
    const w = await world();
    vi.stubEnv("COMMENTS_ENABLED", "");
    await expect(
      postComment(w.fan, w.slop, { kind: "feedback", body: "Hello?" }, { convex: caller(w), check: async () => null }),
    ).rejects.toThrow("Comments are off.");
  });

  it("refuses a blocked comment without saving it, and keeps the attempt charged", async () => {
    const w = await world();
    const check = vi.fn(async (): Promise<ContentCheck> => ({ verdict: "blocked", reason: "Abuse." }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const services = { convex: caller(w), check };

    expect(await postComment(w.fan, w.slop, { kind: "feedback", body: "Ugly words." }, services)).toEqual({
      ok: false,
      error: BLOCKED_COMMENT,
    });
    expect(await w.t.run(async (ctx) => await ctx.db.query("comments").collect())).toEqual([]);
    expect(check).toHaveBeenCalledOnce();
    expect(await w.t.run(async (ctx) => await ctx.db.query("rateLimits").collect())).toContainEqual(
      expect.objectContaining({ key: `comment:${w.fan}` }),
    );
  });

  it("posts an ok comment at once, and holds a mature one for a moderator", async () => {
    const w = await world();
    const check = vi.fn(async (submission: Submission): Promise<ContentCheck> =>
      String(submission.fields.comment).includes("spicy")
        ? { verdict: "mature", reason: "A bit much." }
        : { verdict: "ok", reason: "Fine." },
    );
    const services = { convex: caller(w), check };

    expect(await postComment(w.fan, w.slop, { kind: "feedback", body: "Smooth tilt." }, services)).toMatchObject({
      ok: true,
      held: false,
    });
    expect(await postComment(w.fan, w.slop, { kind: "kudos", body: "spicy art" }, services)).toMatchObject({
      ok: true,
      held: true,
    });

    expect((await w.page())?.comments).toHaveLength(1);
    expect((await w.server.query(api.slops.getForServer, { slopId: w.slopId }))?.commentCount).toBe(1);
    const [held] = await w.server.query(api.comments.queue, {});
    expect(held).toMatchObject({ hidden: true, check: { verdict: "mature", reason: "A bit much." } });
  });

  it("skips the check and the hourly cap once a moderator trusts the commenter", async () => {
    const w = await world();
    const first = vi.fn(async (): Promise<ContentCheck> => ({ verdict: "mature", reason: "A bit much." }));
    await postComment(w.fan, w.slop, { kind: "feedback", body: "First." }, { convex: caller(w), check: first });

    const [held] = await w.server.query(api.comments.queue, {});
    await w.server.mutation(api.comments.decide, {
      moderatorId: w.moderator,
      commentId: held.id,
      decision: "approve",
    });

    const check = vi.fn(async (): Promise<ContentCheck> => ({ verdict: "blocked", reason: "Would block." }));
    const services = { convex: caller(w), check };
    // Past the 30 an hour an untrusted commenter gets: trust lifts the cap.
    for (let index = 0; index < 31; index++) {
      expect(await postComment(w.fan, w.slop, { kind: "feedback", body: `Again ${index}.` }, services)).toMatchObject({
        ok: true,
        held: false,
      });
    }
    expect(check).not.toHaveBeenCalled();
    expect((await w.page())?.comments).toHaveLength(32);
  });
});
