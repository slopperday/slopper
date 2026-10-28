// @vitest-environment edge-runtime
import { type FunctionReference, getFunctionName } from "convex/server";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { checkedContentHash } from "@convex/lib/shape";
import { config } from "~/.server/config";
import { convex, type ConvexCaller } from "~/.server/convex";
import { finishScheduled, launchFlash } from "~/.server/launch";
import { checkSlop } from "~/.server/moderation";
import { convexApp } from "./convexApp";

const originalCheck = config.contentCheck;
const input = {
  name: "Marbles",
  tagline: "Tilt to roll",
  description: "A maze",
  category: "games",
  links: [],
  screenshots: [],
  madeWith: [],
};

afterEach(() => {
  config.contentCheck = originalCheck;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function setup() {
  const t = convexApp();
  const server = t.withIdentity({ subject: "server" });
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: "maker",
    preferredUsername: "maker",
    displayName: "Maker",
    avatarUrl: null,
    timeZone: "UTC",
  });
  // Only the transport and external model are replaced; mutations and queries run in Convex.
  const caller: ConvexCaller = {
    query: async (query, ...args) => await server.query<FunctionReference<"query">>(query, ...args),
    mutation: async (mutation, ...args) => await server.mutation<FunctionReference<"mutation">>(mutation, ...args),
  };
  vi.spyOn(convex, "query").mockImplementation(caller.query);
  vi.spyOn(convex, "mutation").mockImplementation(caller.mutation);
  config.contentCheck = null;
  const create = () => server.mutation(api.slops.create, { userId, input, launchNote: "Day 1" });
  const read = (slopId: Id<"slops">) => server.query(api.slops.getForServer, { slopId });
  const approve = async (slopId: Id<"slops">, verdict: "ok" | "mature" = "ok") => {
    const slop = await read(slopId);
    if (!slop) throw new Error("Missing test launch");
    return server.mutation(api.moderation.applyCheck, {
      slopId,
      scope: "slop",
      verdict,
      reason: "Reviewed",
      contentHash: checkedContentHash(slop),
    });
  };
  const expectPrivate = async (slopId: Id<"slops">, slug = "marbles") => {
    expect(await t.query(api.slops.publicById, { id: slopId })).toBeNull();
    expect(await t.query(api.slops.card, { username: "maker", slug })).toBeNull();
    expect(await t.query(api.slops.page, { username: "maker", slug })).toBeNull();
    expect((await t.query(api.slops.recent, { before: null, limit: 10 })).items).toEqual([]);
    expect((await t.query(api.users.profile, { username: "maker" }))?.items).toEqual([]);
    expect(await server.query(api.moderation.autopostHoldFor, { slopId })).not.toBeNull();
    expect(await server.query(api.slops.page, { username: "maker", slug, asUser: userId })).not.toBeNull();
  };
  return { t, server, userId, create, read, approve, expectPrivate };
}

function provider(reply: "ok" | "mature" | "blocked" | "error" | "malformed") {
  config.contentCheck = { apiKey: "test", baseUrl: "https://model.test", model: "test", provider: "test" };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", async () =>
    reply === "error"
      ? new Response(null, { status: 503 })
      : Response.json({
          choices: [
            {
              message: {
                content: reply === "malformed" ? "invalid" : JSON.stringify({ verdict: reply, reason: "Reviewed" }),
              },
            },
          ],
        }),
  );
}

describe("only checked launches become public", () => {
  for (const failure of ["unconfigured", "error", "malformed"] as const) {
    it.each(["create", "edit", "schedule"] as const)(`holds %s when moderation is ${failure}`, async (path) => {
      const { server, userId, create, approve, expectPrivate } = await setup();
      let launch;
      if (path === "schedule") {
        const { id } = await server.mutation(api.schedule.add, {
          userId,
          input,
          launchNote: "Day 1",
          when: { kind: "next" },
          autopost: false,
        });
        launch = await server.mutation(api.schedule.releaseNow, { id, userId });
      } else {
        launch = await create();
        if (path === "edit") {
          await approve(launch.slopId);
          await server.mutation(api.slops.edit, {
            userId,
            slopId: launch.slopId,
            input: { ...input, description: "Changed" },
          });
        }
      }
      await expectPrivate(launch.slopId);
      if (failure !== "unconfigured") provider(failure);
      expect(await checkSlop(launch.slopId)).toBeNull();
      await expectPrivate(launch.slopId);
      expect(launchFlash("Marbles", { check: null, autopost: null }, false).message).toContain(
        "waiting for a content check",
      );
    });
  }

  it.each(["ok", "mature"] as const)("reveals a matching %s verdict atomically", async (verdict) => {
    const { t, create, expectPrivate, read } = await setup();
    const { slopId } = await create();
    await expectPrivate(slopId);
    provider(verdict);
    expect((await checkSlop(slopId))?.verdict).toBe(verdict);
    expect(await t.query(api.slops.publicById, { id: slopId })).not.toBeNull();
    expect(await read(slopId)).toMatchObject({ hidden: false, nsfw: verdict === "mature" });
  });

  it("rejects missing and stale fingerprints and keeps a check that finishes during an edit pending", async () => {
    const { server, userId, create, read, expectPrivate } = await setup();
    const { slopId } = await create();
    expect(
      await server.mutation(api.moderation.applyCheck, { slopId, scope: "slop", verdict: "ok", reason: "Unbound" }),
    ).toEqual({ applied: false });
    provider("ok");
    // The model sees the old text; a new edit lands before it answers.
    vi.stubGlobal("fetch", async () => {
      await server.mutation(api.slops.edit, {
        userId,
        slopId,
        input: { ...input, description: "Changed while checking" },
      });
      return Response.json({ choices: [{ message: { content: '{"verdict":"ok","reason":"Old text"}' } }] });
    });
    expect(await checkSlop(slopId)).toBeNull();
    expect((await read(slopId))?.check).toBeUndefined();
    await expectPrivate(slopId);
  });

  it("keeps legacy unchecked rows private even if their stored hidden flag is false", async () => {
    const { t, create, expectPrivate } = await setup();
    const { slopId } = await create();
    await t.run((ctx) => ctx.db.patch(slopId, { hidden: false, publishAfterCheck: undefined }));
    await expectPrivate(slopId);
  });

  it("checks the original launch note when retrying through an edit", async () => {
    const { server, userId, create } = await setup();
    const { slopId } = await create();
    await server.mutation(api.slops.edit, { userId, slopId, input: { ...input, description: "Edited" } });
    provider("ok");
    vi.stubGlobal("fetch", async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (typeof init?.body !== "string") throw new Error("Expected a JSON request body");
      const request: unknown = JSON.parse(init.body);
      expect(request).toMatchObject({
        messages: [
          { role: "system" },
          { role: "user", content: [{ type: "text", text: expect.stringContaining('"launchNote":"Day 1"') }] },
        ],
      });
      return Response.json({ choices: [{ message: { content: '{"verdict":"ok","reason":"Reviewed"}' } }] });
    });
    expect((await checkSlop(slopId))?.verdict).toBe("ok");
  });

  it("keeps a blocked launch hidden even when a later check is clean", async () => {
    const { create, expectPrivate } = await setup();
    const { slopId } = await create();
    provider("blocked");
    expect((await checkSlop(slopId))?.verdict).toBe("blocked");
    await expectPrivate(slopId);
    provider("ok");
    expect((await checkSlop(slopId))?.verdict).toBe("ok");
    await expectPrivate(slopId);
  });

  it("does not let a screenshot verdict publish unchecked text", async () => {
    const { t, server, userId, expectPrivate, approve } = await setup();
    const mediaId = await t.run((ctx) =>
      ctx.db.insert("media", {
        ownerId: userId,
        backend: "b2",
        key: "mature.png",
        contentType: "image/png",
        size: 1,
        check: { verdict: "mature", reason: "Mature image" },
      }),
    );
    const { slopId } = await server.mutation(api.slops.create, {
      userId,
      input: { ...input, screenshots: [mediaId] },
      launchNote: "",
    });
    await expectPrivate(slopId);
    await approve(slopId);
    expect(await t.query(api.slops.publicById, { id: slopId })).not.toBeNull();
  });

  it("preserves moderator hides across edits and in-flight checks", async () => {
    const { t, server, userId, create, approve, expectPrivate } = await setup();
    const { userId: adminId } = await server.mutation(api.users.upsertFromIdentity, {
      provider: "dev",
      providerId: "admin",
      preferredUsername: "admin",
      displayName: "Admin",
      avatarUrl: null,
      timeZone: "UTC",
    });
    await t.run((ctx) => ctx.db.patch(adminId, { role: "admin" }));
    const { slopId } = await create();
    await approve(slopId);
    await server.mutation(api.slops.setHidden, { adminId, slopId, hidden: true });
    await server.mutation(api.slops.edit, { userId, slopId, input: { ...input, description: "New text" } });
    await approve(slopId);
    await expectPrivate(slopId);
    await server.mutation(api.slops.setHidden, { adminId, slopId, hidden: false });
    await server.mutation(api.slops.edit, { userId, slopId, input: { ...input, description: "More text" } });
    await server.mutation(api.slops.setHidden, { adminId, slopId, hidden: true });
    await approve(slopId);
    await expectPrivate(slopId);
  });

  it("lets a moderator approve a queued pending launch without clearing automatic posting", async () => {
    const { t, server, create, approve } = await setup();
    const { userId: moderatorId } = await server.mutation(api.users.upsertFromIdentity, {
      provider: "dev",
      providerId: "mod",
      preferredUsername: "mod",
      displayName: "Mod",
      avatarUrl: null,
      timeZone: "UTC",
    });
    await t.run((ctx) => ctx.db.patch(moderatorId, { role: "moderator" }));
    const { slopId } = await create();
    await server.mutation(api.moderation.flag, { userId: moderatorId, slopId, reason: "Needs review" });
    await server.mutation(api.moderation.decide, { moderatorId, slopId, decision: "fine" });
    expect(await t.query(api.slops.publicById, { id: slopId })).not.toBeNull();
    expect(await server.query(api.moderation.autopostHoldFor, { slopId })).toBe("it hasn't been cleared yet");
    await approve(slopId);
    expect(await server.query(api.moderation.autopostHoldFor, { slopId })).toBeNull();
    provider("blocked");
    await checkSlop(slopId);
    await server.mutation(api.moderation.decide, { moderatorId, slopId, decision: "fine" });
    expect(await t.query(api.slops.publicById, { id: slopId })).not.toBeNull();
    expect(await server.query(api.moderation.autopostHoldFor, { slopId })).not.toBeNull();
  });

  it("keeps failed scheduled checks retryable and acknowledges only the current claim", async () => {
    vi.useFakeTimers();
    const { t, server, userId, expectPrivate } = await setup();
    const { id } = await server.mutation(api.schedule.add, {
      userId,
      input,
      launchNote: "Day 1",
      when: { kind: "next" },
      autopost: false,
    });
    const launch = await server.mutation(api.schedule.releaseNow, { userId, id });
    const owner = { _id: userId, username: "maker" };
    expect((await finishScheduled(owner, id, launch)).check).toBeNull();
    await expectPrivate(launch.slopId);
    const claimed = await server.mutation(api.schedule.claim, { id });
    if (!claimed) throw new Error("Failed check lost its retry record");
    await server.mutation(api.schedule.complete, { id, claimVersion: launch.claimVersion, checked: false });
    expect(await server.mutation(api.schedule.claim, { id })).toBeNull();
    vi.advanceTimersByTime(5 * 60_000 + 1);
    const retry = await server.mutation(api.schedule.claim, { id });
    if (!retry) throw new Error("Expired claim did not recover");
    await server.mutation(api.schedule.complete, { id, claimVersion: claimed.claimVersion, checked: true });
    expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
    provider("ok");
    expect((await finishScheduled(owner, id, retry)).check?.verdict).toBe("ok");
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
    expect(await t.query(api.slops.publicById, { id: launch.slopId })).not.toBeNull();
  });

  it("keeps a timed release private when its app callback cannot run", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async () => new Response(null, { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { t, server, userId, expectPrivate } = await setup();
    const { id } = await server.mutation(api.schedule.add, {
      userId,
      input,
      launchNote: "Day 1",
      when: { kind: "next" },
      autopost: false,
    });
    await t.mutation(internal.schedule.release, { id });
    const [launch] = await server.query(api.slops.listForServer, { userId });
    await expectPrivate(launch._id);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.get(id))).not.toBeNull();
  });

  it("never announces through a replaced completion lease", async () => {
    vi.useFakeTimers();
    const { server, userId } = await setup();
    const { id } = await server.mutation(api.schedule.add, {
      userId,
      input,
      launchNote: "",
      when: { kind: "next" },
      autopost: true,
    });
    const first = await server.mutation(api.schedule.releaseNow, { userId, id });
    vi.advanceTimersByTime(5 * 60_000 + 1);
    const next = await server.mutation(api.schedule.claim, { id });
    if (!next) throw new Error("Expired lease did not recover");
    provider("ok");
    const owner = { _id: userId, username: "maker" };
    expect(await finishScheduled(owner, id, first)).toEqual({ check: null, autopost: null });
    expect(await server.mutation(api.schedule.claim, { id })).toBeNull();
    expect((await finishScheduled(owner, id, next)).autopost?.status).toBe("posted");
    expect(await server.query(api.schedule.mine, { asUser: userId })).toEqual([]);
  });

  it("does not retry an announcement when its terminal completion was consumed", async () => {
    const { t, server, userId } = await setup();
    const { id } = await server.mutation(api.schedule.add, {
      userId,
      input,
      launchNote: "",
      when: { kind: "next" },
      autopost: true,
    });
    const launch = await server.mutation(api.schedule.releaseNow, { userId, id });
    provider("ok");
    // A transport failure in the announcement phase must not replay that phase later.
    const failAnnouncement: ConvexCaller["query"] = async (query, ...args) => {
      if (getFunctionName(query) === "accounts:list") throw new Error("Announcement transport failed");
      return server.query<FunctionReference<"query">>(query, ...args);
    };
    vi.spyOn(convex, "query").mockImplementation(failAnnouncement);
    await expect(finishScheduled({ _id: userId, username: "maker" }, id, launch)).rejects.toThrow(
      "Announcement transport failed",
    );
    expect(await server.mutation(api.schedule.claim, { id })).toBeNull();
    expect(await server.query(api.schedule.mine, { asUser: userId })).toEqual([]);
    expect(await t.query(api.slops.publicById, { id: launch.slopId })).not.toBeNull();
  });

  it("releases a deleted launch's media while its failed completion is still queued", async () => {
    vi.useFakeTimers();
    const { t, server, userId } = await setup();
    const mediaId = await t.run((ctx) =>
      ctx.db.insert("media", {
        ownerId: userId,
        backend: "b2",
        key: "queued.png",
        contentType: "image/png",
        size: 1,
      }),
    );
    const { id } = await server.mutation(api.schedule.add, {
      userId,
      input: { ...input, screenshots: [mediaId] },
      launchNote: "",
      when: { kind: "next" },
      autopost: false,
    });
    const { slopId } = await server.mutation(api.schedule.releaseNow, { userId, id });
    expect(await server.mutation(api.slops.remove, { slopId, byUserId: userId })).toEqual({ orphaned: 1 });
    expect((await t.run((ctx) => ctx.db.get(mediaId)))?.orphanedAt).toBeTypeOf("number");
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect(await server.mutation(api.schedule.claim, { id })).toBeNull();
    expect(await t.run((ctx) => ctx.db.get(id))).toBeNull();
  });
});
