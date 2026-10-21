import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { readerFor, requireServer } from "./lib/auth";
import { releaseMedia } from "./lib/media";
import { consume } from "./lib/rate";
import { productIdOf, screenshotUrls } from "./lib/shape";
import { insertLaunch, ownedMedia, ownedPublication, ownSlop, slopInput } from "./slops";
import { utcDate } from "../app/lib/dates";
import { LIMITS } from "../app/lib/model";
import { nextFreeRelease, releaseProblem } from "../app/lib/schedule";

/**
 * Scheduled launches (see app/lib/schedule.ts). A queued launch is not a
 * slop yet: no feed, race, goal or vote sees it. At `releaseAt` Convex puts
 * it out through the same `insertLaunch` as a launch made now, then asks the
 * app server to run the content check and auto-post it, which only the app
 * server can do (it holds the model key and the sealed account keys).
 */

const RETRIES = 3;

async function queueOf(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"scheduledLaunches">[]> {
  return await ctx.db
    .query("scheduledLaunches")
    .withIndex("by_user_release", (q) => q.eq("userId", userId))
    .collect();
}

/** UTC dates of a person's launches still waiting to go out, for the goal grid. */
export async function queuedDays(ctx: QueryCtx, user: Doc<"users">): Promise<string[]> {
  return (await queueOf(ctx, user._id)).filter((entry) => !entry.released).map((entry) => utcDate(entry.releaseAt));
}

/** When "next free day" would put a launch out: the first day with nothing out or queued. */
async function nextRelease(ctx: QueryCtx, user: Doc<"users">, now: number): Promise<number> {
  const slops = await ctx.db
    .query("slops")
    .withIndex("by_user", (q) => q.eq("userId", user._id))
    .collect();
  const queued = await queueOf(ctx, user._id);
  const taken = new Set([
    ...slops.filter((slop) => !slop.hidden).map((slop) => slop.launchDate),
    ...queued.map((entry) => utcDate(entry.releaseAt)),
  ]);
  return nextFreeRelease(taken, utcDate(now), now);
}

async function ownEntry(ctx: QueryCtx, userId: Id<"users">, rawId: string): Promise<Doc<"scheduledLaunches">> {
  const id = ctx.db.normalizeId("scheduledLaunches", rawId);
  const entry = id ? await ctx.db.get(id) : null;
  if (!entry || entry.userId !== userId) throw new ConvexError("That scheduled launch isn't yours.");
  return entry;
}

/** Turns a queued launch into a slop, on today's UTC date like any launch. */
async function putOut(ctx: MutationCtx, entry: Doc<"scheduledLaunches">) {
  const owner = await ctx.db.get(entry.userId);
  if (!owner) throw new Error(`Scheduled launch ${entry._id} has no owner.`);
  // Deleting a product with launches queued is refused (`slops.remove`), so the source is still here.
  const source = entry.productId ? await ctx.db.get(entry.productId) : null;
  const { name, tagline, description, category, links, madeWith, demo, features, audience } = entry;
  return await insertLaunch(ctx, {
    userId: entry.userId,
    input: { name, tagline, description, category, links, madeWith, demo, features, audience },
    screenshots: await ownedMedia(ctx, entry.userId, entry.screenshots, source?.screenshots),
    publication: entry.publication ?? null,
    launchNote: entry.launchNote,
    source,
    launchLabel: entry.launchLabel,
  });
}

/** For the new slop form: when "next free day" lands right now. */
export const nextFree = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<number | null> => {
    await requireServer(ctx);
    const user = await ctx.db.get(userId);
    return user ? await nextRelease(ctx, user, Date.now()) : null;
  },
});

/** Queues a launch for later. It goes out at `when`, or on the next free day. */
export const add = mutation({
  args: {
    userId: v.id("users"),
    input: slopInput,
    launchNote: v.string(),
    when: v.union(v.object({ kind: v.literal("next") }), v.object({ kind: v.literal("at"), at: v.number() })),
    autopost: v.boolean(),
    relaunchOf: v.optional(v.id("slops")),
    launchLabel: v.optional(v.string()),
  },
  handler: async (ctx, { userId, input, launchNote, when, autopost, relaunchOf, launchLabel }) => {
    await requireServer(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("Account not found.");
    const waiting = (await queueOf(ctx, userId)).filter((entry) => !entry.released);
    if (waiting.length >= LIMITS.scheduled) {
      throw new ConvexError(`You have ${LIMITS.scheduled} launches waiting already. Let some go out first.`);
    }
    const source = relaunchOf ? await ownSlop(ctx, userId, relaunchOf) : null;
    const label = launchLabel?.trim() ?? "";
    if (source && !label) throw new ConvexError("Say what's launching: a platform, a version, a new app.");
    const now = Date.now();
    const releaseAt = when.kind === "next" ? await nextRelease(ctx, user, now) : when.at;
    const problem = releaseProblem(releaseAt, now);
    if (problem) throw new ConvexError(problem);
    await consume(ctx, `ship:${userId}`, 20, 86_400_000);

    const { screenshots, publication: rawPublication, ...fields } = input;
    const publication = await ownedPublication(ctx, userId, rawPublication, source?.publication);
    const id = await ctx.db.insert("scheduledLaunches", {
      userId,
      releaseAt,
      ...fields,
      screenshots: await ownedMedia(ctx, userId, screenshots, source?.screenshots),
      ...(publication ? { publication } : {}),
      launchNote,
      productId: source ? productIdOf(source) : null,
      launchLabel: source ? label.slice(0, LIMITS.launchLabelLength) : null,
      autopost,
    });
    await ctx.scheduler.runAt(releaseAt, internal.schedule.release, { id });
    return { id, releaseAt };
  },
});

/** At `releaseAt`: the launch goes out, then the app server checks and auto-posts it. */
export const release = internalMutation({
  args: { id: v.id("scheduledLaunches") },
  handler: async (ctx, { id }) => {
    const entry = await ctx.db.get(id);
    // Already out early ("Put it out now") or cancelled.
    if (!entry || entry.released) return;
    const { slopId, updateId } = await putOut(ctx, entry);
    await ctx.db.patch(id, { released: { slopId, updateId } });
    await ctx.scheduler.runAfter(0, internal.schedule.tellApp, { id, attempt: 1 });
  },
});

/**
 * Asks the app server to finish a release (`/api/scheduled/:id`). The
 * request carries nothing but the id: the app server claims the release
 * from Convex, and a release can be claimed once, so a forged call can only
 * do early what this one was about to do.
 */
export const tellApp = internalAction({
  args: { id: v.id("scheduledLaunches"), attempt: v.number() },
  handler: async (ctx, { id, attempt }) => {
    const base = (process.env.APP_URL ?? "https://slopper.day").replace(/\/+$/, "");
    try {
      const response = await fetch(`${base}/api/scheduled/${id}`, {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
      });
      // 404: nothing left to claim, because the owner (or an earlier try) finished it.
      if (!response.ok && response.status !== 404) throw new Error(`The app server answered ${response.status}.`);
    } catch (error) {
      console.error(`Couldn't finish scheduled launch ${id} (attempt ${attempt})`, error);
      // Past the last try, the owner finishes it from their queue.
      if (attempt < RETRIES) {
        await ctx.scheduler.runAfter(attempt * 60_000, internal.schedule.tellApp, { id, attempt: attempt + 1 });
      }
    }
  },
});

/**
 * Hands a release that's out to the app server, once: the row goes, so the
 * check and auto-post run exactly once. Null when there's nothing to claim.
 * With `userId`, only that person's release is claimed (their queue's
 * "finish" button).
 */
export const claim = mutation({
  args: { id: v.string(), userId: v.optional(v.id("users")) },
  handler: async (ctx, { id: rawId, userId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("scheduledLaunches", rawId);
    const entry = id ? await ctx.db.get(id) : null;
    if (!entry?.released || (userId && entry.userId !== userId)) return null;
    await ctx.db.delete(entry._id);
    // Its owner deleted the slop before it was finished: nothing to check or post.
    if (!(await ctx.db.get(entry.released.slopId))) return null;
    return {
      userId: entry.userId,
      slopId: entry.released.slopId,
      updateId: entry.released.updateId,
      launchNote: entry.launchNote,
      autopost: entry.autopost,
      name: entry.name,
      launchLabel: entry.launchLabel,
    };
  },
});

/** Puts a queued launch out now, for the app server to check and auto-post inline. */
export const releaseNow = mutation({
  args: { userId: v.id("users"), id: v.string() },
  handler: async (ctx, { userId, id }) => {
    await requireServer(ctx);
    const entry = await ownEntry(ctx, userId, id);
    if (entry.released) throw new ConvexError("That one is already out.");
    const created = await putOut(ctx, entry);
    await ctx.db.delete(entry._id);
    const { launchNote, autopost, name, launchLabel } = entry;
    return { ...created, launchNote, autopost, name, launchLabel };
  },
});

export const cancel = mutation({
  args: { userId: v.id("users"), id: v.string() },
  handler: async (ctx, { userId, id }) => {
    await requireServer(ctx);
    const entry = await ownEntry(ctx, userId, id);
    if (entry.released) throw new ConvexError("That one is already out. Delete the slop instead.");
    await ctx.db.delete(entry._id);
    const media = entry.publication ? [...entry.screenshots, entry.publication] : entry.screenshots;
    return { name: entry.name, orphaned: await releaseMedia(ctx, userId, media) };
  },
});

/**
 * The reader's own queue, soonest first; empty for everyone else. A launch
 * that's `out` went out but wasn't checked and auto-posted yet.
 */
export const mine = query({
  args: { asUser: v.optional(v.id("users")) },
  handler: async (ctx, { asUser }) => {
    const reader = await readerFor(ctx, asUser);
    if (!reader) return [];
    const queue = await queueOf(ctx, reader._id);
    const items = [];
    for (const entry of queue) {
      const slop = entry.released ? await ctx.db.get(entry.released.slopId) : null;
      // Out, then deleted by its owner before it was finished: nothing left to show.
      if (entry.released && !slop) continue;
      const [cover] = await screenshotUrls(ctx, entry.screenshots.slice(0, 1));
      items.push({
        id: entry._id,
        releaseAt: entry.releaseAt,
        name: entry.name,
        tagline: entry.tagline,
        launchLabel: entry.launchLabel,
        relaunch: entry.productId !== null,
        autopost: entry.autopost,
        cover: cover ?? null,
        out: slop ? { slug: slop.slug } : null,
      });
    }
    return items;
  },
});
