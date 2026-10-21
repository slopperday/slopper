import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { captureFor } from "./analytics";
import { readerFor, requireServer } from "./lib/auth";
import { notify } from "./lib/notify";
import { can, requirePermission } from "./lib/permissions";
import { logStaffAction } from "./lib/staffLog";
import { consume, nextCounter, spent } from "./lib/rate";
import { reviewsFor } from "./lib/reviews";
import {
  checkedContentOf,
  isVisibleTo,
  productIdOf,
  publicSlop,
  publicUpdate,
  publicUser,
  toCards,
  voteOf,
} from "./lib/shape";
import { demoVideoValidator, featureValidator, linkValidator } from "./schema";
import { openGoal } from "./goals";
import { tractionFor } from "./integrations";
import { countedInRace, countsInRace, raceTally, utcToday } from "./race";
import { isImage, isPublication, releaseMedia, updateMedia } from "./lib/media";
import { checkScreenshots } from "./moderation";
import { scheduleEmbedding } from "./search";
import { retag } from "./lib/tags";
import { EDITING_CLOSED, editableUntil } from "../app/lib/editing";
import { goalDayFor } from "../app/lib/goal";
import { categoryFilter, LIMITS } from "../app/lib/model";
import { renderMarkdown } from "../app/lib/markdown";
import { rankHot } from "../app/lib/ranking";
import { embeddingText } from "../app/lib/search";
import { moneyTotals } from "../app/lib/money";
import { slugify } from "../app/lib/username";
import { utcDate } from "../app/lib/dates";

export const slopInput = v.object({
  name: v.string(),
  tagline: v.string(),
  description: v.string(),
  category: v.string(),
  links: v.array(linkValidator),
  /** Media ids as typed or sent by an agent; checked against ownership. */
  screenshots: v.array(v.string()),
  /** A publication's media id (a PDF or EPUB), or null for none. Left out, it stays as it is. */
  publication: v.optional(v.union(v.string(), v.null())),
  madeWith: v.array(v.string()),
  /** The product page. Left out, they stay as they are. */
  demo: v.optional(v.union(demoVideoValidator, v.null())),
  features: v.optional(v.array(featureValidator)),
  audience: v.optional(v.string()),
});

/**
 * Keeps only media the user uploaded (or already attached), in order, up to
 * `max`. Orphaned media is on its way out. Whatever is kept is attached: it
 * leaves the never-attached sweep's pool (`media.sweepUnattached`).
 */
export async function ownedMedia(
  ctx: MutationCtx,
  userId: Id<"users">,
  ids: readonly string[],
  alreadyAttached: readonly Id<"media">[] = [],
  max: number = LIMITS.screenshots,
): Promise<Id<"media">[]> {
  const kept: Id<"media">[] = [];
  for (const raw of new Set(ids)) {
    const id = ctx.db.normalizeId("media", raw);
    if (!id) continue;
    if (alreadyAttached.includes(id)) {
      kept.push(id);
      continue;
    }
    const media = await ctx.db.get(id);
    // Videos go through set_video and a moderator, and PDFs and EPUBs in as publications, never as screenshots.
    if (media?.ownerId === userId && media.orphanedAt === undefined && isImage(media)) kept.push(id);
  }
  const attached = kept.slice(0, max);
  for (const id of new Set(attached)) {
    const media = await ctx.db.get(id);
    if (media && media.attached !== true) await ctx.db.patch(id, { attached: true });
  }
  return attached;
}

/**
 * The publication a launch will show: a PDF or EPUB the user uploaded, or the one
 * already on it (or on the launch it relaunches). Null for none.
 */
export async function ownedPublication(
  ctx: MutationCtx,
  userId: Id<"users">,
  raw: string | null | undefined,
  alreadyAttached?: Id<"media">,
): Promise<Id<"media"> | null> {
  if (!raw) return null;
  const id = ctx.db.normalizeId("media", raw);
  if (id && id === alreadyAttached) return id;
  const media = id ? await ctx.db.get(id) : null;
  if (!media || media.ownerId !== userId || media.orphanedAt !== undefined || !isPublication(media)) {
    throw new ConvexError("That isn't one of your uploaded publications.");
  }
  // A slop now shows it, so it's attached (`media.sweepUnattached`).
  if (media.attached !== true) await ctx.db.patch(media._id, { attached: true });
  return media._id;
}

async function freeSlug(ctx: QueryCtx, userId: Id<"users">, base: string): Promise<string> {
  for (let i = 1; i < 100; i++) {
    const slug = i === 1 ? base : `${base.slice(0, 36)}-${i}`;
    const taken = await ctx.db
      .query("slops")
      .withIndex("by_user_slug", (q) => q.eq("userId", userId).eq("slug", slug))
      .first();
    if (!taken) return slug;
  }
  return `${base.slice(0, 30)}-${Date.now().toString(36)}`;
}

export async function ownSlop(ctx: QueryCtx, userId: Id<"users">, slopId: Id<"slops">): Promise<Doc<"slops">> {
  const slop = await ctx.db.get(slopId);
  if (!slop || slop.userId !== userId) throw new ConvexError("That slop isn't yours.");
  return slop;
}

export type SlopInput = Infer<typeof slopInput>;

/** A launch ready to go out, its screenshots and publication already checked as the owner's. */
export interface LaunchDraft {
  userId: Id<"users">;
  input: Omit<SlopInput, "screenshots" | "publication">;
  screenshots: Id<"media">[];
  publication: Id<"media"> | null;
  launchNote: string;
  /** For another launch of a product: one of its earlier launches. */
  source: Doc<"slops"> | null;
  launchLabel: string | null;
}

/**
 * Puts a launch out: counts it towards the open goal, enters it in today's
 * race and posts its launch note as the first update. Today is the UTC day,
 * for everyone: the day its goal, streak and race all count it on.
 */
export async function insertLaunch(ctx: MutationCtx, draft: LaunchDraft) {
  const { userId, input, screenshots, publication, launchNote, source, launchLabel } = draft;
  const now = Date.now();
  const today = utcDate(now);
  const goal = await openGoal(ctx, userId, today);
  const goalDay = goal ? goalDayFor(goal, today) : null;
  const slug = await freeSlug(ctx, userId, slugify(source ? `${input.name} ${launchLabel}` : input.name));
  const slopId = await ctx.db.insert("slops", {
    userId,
    productId: source ? productIdOf(source) : null,
    launchLabel: source ? (launchLabel ?? "").trim().slice(0, LIMITS.launchLabelLength) : null,
    slug,
    ...input,
    madeWith: await retag(ctx, [], input.madeWith),
    // Set by the content check, flags or moderators; never by the maker.
    nsfw: false,
    screenshots,
    ...(publication ? { publication } : {}),
    launchDate: today,
    raceDate: today,
    goalId: goalDay && goal ? goal._id : null,
    goalDay,
    goalLength: goalDay && goal ? goal.days : null,
    number: await nextCounter(ctx, "slops"),
    upvotes: 0,
    downvotes: 0,
    raceUpvotes: 0,
    raceDownvotes: 0,
    commentCount: 0,
    updateCount: 1,
    fieldTests: 0,
    backers: 0,
    pledged: 0,
    lastActivityAt: now,
    slopOfTheDay: null,
    slopcessfulAt: null,
    slopcessfulNote: null,
    crosspost: {},
    moneyPublic: false,
    hidden: false,
  });
  const updateId = await ctx.db.insert("updates", {
    slopId,
    userId,
    kind: "launch",
    body: launchNote,
    crossposts: [],
  });
  const blurred = await checkScreenshots(ctx, slopId, publication ? [...screenshots, publication] : screenshots);
  await scheduleEmbedding(ctx, slopId);
  await captureFor(ctx, userId, {
    name: "slop launched",
    slopId,
    properties: { category: input.category, relaunch: source !== null, goalDay },
  });
  return { slopId, updateId, slug, blurred };
}

/**
 * Ships a launch: a new product, or (with `relaunchOf`) another launch of an
 * existing one. Counts towards the open goal and enters today's race.
 */
export const create = mutation({
  args: {
    userId: v.id("users"),
    input: slopInput,
    launchNote: v.string(),
    relaunchOf: v.optional(v.id("slops")),
    launchLabel: v.optional(v.string()),
  },
  handler: async (ctx, { userId, input, launchNote, relaunchOf, launchLabel }) => {
    await requireServer(ctx);
    await consume(ctx, `ship:${userId}`, 20, 86_400_000);
    const source = relaunchOf ? await ownSlop(ctx, userId, relaunchOf) : null;
    if (source && !launchLabel?.trim())
      throw new ConvexError("Say what's launching: a platform, a version, a new app.");
    const { screenshots, publication, ...fields } = input;
    return await insertLaunch(ctx, {
      userId,
      input: fields,
      screenshots: await ownedMedia(ctx, userId, screenshots, source?.screenshots),
      publication: await ownedPublication(ctx, userId, publication, source?.publication),
      launchNote,
      source,
      launchLabel: launchLabel ?? null,
    });
  },
});

/**
 * Changes the original post, only while its edit window is open
 * (app/lib/editing.ts); after that the owner posts updates instead. The
 * promo video (videos.set) isn't part of the post: a moderator approves
 * each one, so it stays changeable.
 */
export const edit = mutation({
  args: { userId: v.id("users"), slopId: v.id("slops"), input: slopInput },
  handler: async (ctx, { userId, slopId, input }) => {
    await requireServer(ctx);
    await consume(ctx, `edit:${userId}`, 30, 86_400_000);
    const slop = await ownSlop(ctx, userId, slopId);
    const until = editableUntil({ launchedAt: slop._creationTime, launchDate: slop.launchDate });
    if (Date.now() >= until) throw new ConvexError(EDITING_CLOSED);
    const { publication: rawPublication, ...fields } = input;
    const screenshots = await ownedMedia(ctx, userId, fields.screenshots, slop.screenshots);
    const publication =
      rawPublication === undefined
        ? (slop.publication ?? null)
        : await ownedPublication(ctx, userId, rawPublication, slop.publication);
    const madeWith = await retag(ctx, slop.madeWith, fields.madeWith);
    // An edit that changes what the check reads clears the old verdict, so a
    // re-check that errors leaves the slop uncleared — held like a launch
    // whose check failed — instead of showing a stale "ok" over new text.
    // A verdict already in flight for the old text won't land either
    // (moderation.applyCheck ties verdicts to the content they judged).
    const rechecked = checkedContentOf({ ...fields, publication }) !== checkedContentOf(slop);
    // An undefined field is removed by the patch.
    await ctx.db.patch(slopId, {
      ...fields,
      madeWith,
      screenshots,
      publication: publication ?? undefined,
      ...(rechecked ? { check: undefined } : {}),
    });
    if (embeddingText(fields) !== embeddingText(slop)) await scheduleEmbedding(ctx, slopId);
    const shown = (ids: Id<"media">[], pdf: Id<"media"> | null | undefined) => (pdf ? [...ids, pdf] : ids);
    const blurred = await checkScreenshots(
      ctx,
      slopId,
      shown(screenshots, publication),
      shown(slop.screenshots, slop.publication),
    );
    const dropped = shown(slop.screenshots, slop.publication).filter(
      (id) => !screenshots.includes(id) && id !== publication,
    );
    return { blurred, orphaned: await releaseMedia(ctx, userId, dropped) };
  },
});

export const setCrosspost = mutation({
  args: {
    userId: v.id("users"),
    slopId: v.id("slops"),
    modes: v.record(v.string(), v.union(v.literal("post"), v.literal("amplify"), v.literal("off"))),
  },
  handler: async (ctx, { userId, slopId, modes }) => {
    await requireServer(ctx);
    await ownSlop(ctx, userId, slopId);
    await ctx.db.patch(slopId, { crosspost: modes });
  },
});

/** An admin hides a slop from Slopper, or brings it back. Hiding closes its flags. */
export const setHidden = mutation({
  args: { adminId: v.id("users"), slopId: v.id("slops"), hidden: v.boolean() },
  handler: async (ctx, { adminId, slopId, hidden }) => {
    await requireServer(ctx);
    await requirePermission(ctx, adminId, "slops.hide");
    const slop = await ctx.db.get(slopId);
    if (!slop) throw new ConvexError("That slop is gone.");
    await ctx.db.patch(slopId, { hidden });
    if (slop.hidden !== hidden) await logStaffAction(ctx, adminId, { type: "hidden", slopId, hidden }, slop);
    if (hidden) {
      const reports = await ctx.db
        .query("reports")
        .withIndex("by_slop", (q) => q.eq("slopId", slopId))
        .collect();
      for (const report of reports) await ctx.db.delete(report._id);
    }
  },
});

/**
 * Scrapes a launch off the wall with everything attached to it. Its owner
 * can; so can admins, and the staff log records it when they do.
 */
export const remove = mutation({
  args: { slopId: v.id("slops"), byUserId: v.id("users") },
  handler: async (ctx, { slopId, byUserId }) => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop) return { orphaned: 0 };
    if (slop.userId !== byUserId) {
      if (!can(await ctx.db.get(byUserId), "slops.deleteAny")) throw new ConvexError("That slop isn't yours.");
      await logStaffAction(ctx, byUserId, { type: "deleteSlop", slopId, ownerId: slop.userId }, slop);
    }
    const later = await ctx.db
      .query("slops")
      .withIndex("by_product", (q) => q.eq("productId", slopId))
      .first();
    if (later) throw new ConvexError("Delete this product's later launches first.");
    const queued = await ctx.db
      .query("scheduledLaunches")
      .withIndex("by_product", (q) => q.eq("productId", slopId))
      .first();
    if (queued) throw new ConvexError("Cancel this product's scheduled launches first.");

    const updates = await ctx.db
      .query("updates")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .collect();
    for (const row of updates) await ctx.db.delete(row._id);
    const updateImages = updates.flatMap(updateMedia);
    const comments = await ctx.db
      .query("comments")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .collect();
    for (const row of comments) await ctx.db.delete(row._id);
    // Reviewers own their screenshots, so each one's are let go on their own.
    const reviews = await ctx.db
      .query("reviews")
      .withIndex("by_slop_user", (q) => q.eq("slopId", slopId))
      .collect();
    let reviewImages = 0;
    for (const row of reviews) {
      await ctx.db.delete(row._id);
      reviewImages += await releaseMedia(ctx, row.userId, row.images);
    }
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .collect();
    for (const row of reports) await ctx.db.delete(row._id);
    const pledges = await ctx.db
      .query("pledges")
      .withIndex("by_slop_user", (q) => q.eq("slopId", slopId))
      .collect();
    for (const row of pledges) await ctx.db.delete(row._id);
    const votes = await ctx.db
      .query("votes")
      .withIndex("by_slop_user", (q) => q.eq("slopId", slopId))
      .collect();
    // Today's votes stay past the slop they were cast on: a vote is one of
    // the day's five whether or not its slop survives, so deleting a slop
    // can't hand its voters their budget back to spend again. They're rows
    // about nothing now — tomorrow's deletion sweeps nothing, but each row
    // is small and bounded by the day's votes.
    const today = utcToday();
    for (const row of votes) {
      if (row.castOn === today) continue;
      await ctx.db.delete(row._id);
    }
    if (slop.productId === null) {
      const ledger = await ctx.db
        .query("ledger")
        .withIndex("by_product", (q) => q.eq("productId", slopId))
        .collect();
      for (const entry of ledger) await ctx.db.delete(entry._id);
      const sources = await ctx.db
        .query("integrations")
        .withIndex("by_product", (q) => q.eq("productId", slopId))
        .collect();
      for (const source of sources) {
        const metrics = await ctx.db
          .query("metrics")
          .withIndex("by_integration_date", (q) => q.eq("integrationId", source._id))
          .collect();
        for (const row of metrics) await ctx.db.delete(row._id);
        await ctx.db.delete(source._id);
      }
    }
    for (const review of await ctx.db
      .query("videoReviews")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .collect()) {
      await ctx.db.delete(review._id);
    }
    if (slop.embeddingId) await ctx.db.delete(slop.embeddingId);
    await retag(ctx, slop.madeWith, []);
    await ctx.db.delete(slopId);
    const media = [
      ...slop.screenshots,
      ...(slop.video ? [slop.video.mediaId] : []),
      ...(slop.publication ? [slop.publication] : []),
      ...updateImages,
    ];
    return { orphaned: (await releaseMedia(ctx, slop.userId, media)) + reviewImages };
  },
});

/** How many votes a person cast on a UTC day (see `LIMITS.votesPerDay`). */
async function votesCastOn(ctx: QueryCtx, userId: Id<"users">, date: string): Promise<number> {
  const votes = await ctx.db
    .query("votes")
    .withIndex("by_user_cast_on", (q) => q.eq("userId", userId).eq("castOn", date))
    .collect();
  return votes.length;
}

/**
 * Upvote, private downvote, or clear (0). Everyone gets `LIMITS.votesPerDay`
 * votes per UTC day: a new vote, or changing one cast on an earlier day,
 * spends one; switching today's vote is free, and clearing it gives it back.
 * Counters move in the same transaction, the race's too when it's the
 * slop's race day (`countsInRace`), and upvotes notify the owner.
 */
export const vote = mutation({
  args: { userId: v.id("users"), slopId: v.string(), value: v.union(v.literal(1), v.literal(-1), v.literal(0)) },
  handler: async (ctx, { userId, slopId: rawId, value }) => {
    await requireServer(ctx);
    const slopId = ctx.db.normalizeId("slops", rawId);
    const slop = slopId ? await ctx.db.get(slopId) : null;
    if (!slop || slop.hidden) throw new ConvexError("Slop not found.");
    if (slop.userId === userId) throw new ConvexError("You can't vote on your own slop.");
    const voter = await ctx.db.get(userId);
    if (!voter) throw new ConvexError("Sign in again to vote.");
    await consume(ctx, `vote:${userId}`, 120, 3_600_000);
    const now = Date.now();
    const today = utcToday();
    const used = await votesCastOn(ctx, userId, today);
    const existing = await ctx.db
      .query("votes")
      .withIndex("by_slop_user", (q) => q.eq("slopId", slop._id).eq("userId", userId))
      .unique();
    const previous = existing?.value ?? 0;
    if (previous === value) return { upvotes: slop.upvotes, vote: value, votesLeft: LIMITS.votesPerDay - used };

    const castToday = existing?.castOn === today;
    const spends = value !== 0 && !castToday;
    if (spends && used >= LIMITS.votesPerDay) {
      throw new ConvexError(`You've used your ${LIMITS.votesPerDay} votes for today. More at midnight UTC.`);
    }
    const upvotes = slop.upvotes + (value === 1 ? 1 : 0) - (previous === 1 ? 1 : 0);
    const downvotes = slop.downvotes + (value === -1 ? 1 : 0) - (previous === -1 ? 1 : 0);
    // The race only moves on its own day; after that its tally stands.
    const raceDay = slop.raceDate === today;
    const counted = raceDay && existing !== null && countedInRace(existing, slop);
    const inRace = raceDay && value !== 0 && (await countsInRace(ctx, voter, slop, value, now));
    const race = raceTally(slop);
    await ctx.db.patch(slop._id, {
      upvotes,
      downvotes,
      ...(raceDay && {
        raceUpvotes: race.upvotes + (inRace && value === 1 ? 1 : 0) - (counted && previous === 1 ? 1 : 0),
        raceDownvotes: race.downvotes + (inRace && value === -1 ? 1 : 0) - (counted && previous === -1 ? 1 : 0),
      }),
    });
    if (value === 0 && existing) await ctx.db.delete(existing._id);
    else if (existing && value !== 0) await ctx.db.patch(existing._id, { value, castOn: today, inRace });
    else if (value !== 0) await ctx.db.insert("votes", { slopId: slop._id, userId, value, castOn: today, inRace });
    if (value === 1 && (await spent(ctx, `notify-upvote:${slop._id}:${userId}`, 1, 3_600_000))) {
      await notify(ctx, { userId: slop.userId, kind: "upvote", slopId: slop._id, actorId: userId, amount: null });
    }
    await captureFor(ctx, userId, {
      name: value === 1 ? "upvoted" : value === -1 ? "downvoted" : "unvoted",
      slopId: slop._id,
    });
    const returned = value === 0 && castToday ? 1 : 0;
    return { upvotes, vote: value, votesLeft: LIMITS.votesPerDay - used - (spends ? 1 : 0) + returned };
  },
});

/** The reader's votes left today (UTC); null for visitors. */
export const votesLeft = query({
  args: { asUser: v.optional(v.id("users")) },
  handler: async (ctx, { asUser }): Promise<number | null> => {
    const reader = await readerFor(ctx, asUser);
    if (!reader) return null;
    return LIMITS.votesPerDay - (await votesCastOn(ctx, reader._id, utcToday()));
  },
});

/** "Take my money": one non-binding pledge per person per launch. */
export const pledge = mutation({
  args: { userId: v.id("users"), slopId: v.string(), amount: v.number() },
  handler: async (ctx, { userId, slopId: rawId, amount }) => {
    await requireServer(ctx);
    if (!Number.isInteger(amount) || amount < 0 || amount > LIMITS.maxPledge) {
      throw new ConvexError("Pledges go up to $10,000.");
    }
    const slopId = ctx.db.normalizeId("slops", rawId);
    const slop = slopId ? await ctx.db.get(slopId) : null;
    if (!slop || slop.hidden) throw new ConvexError("Slop not found.");
    if (slop.userId === userId) throw new ConvexError("You can't pledge to your own slop.");
    await consume(ctx, `pledge:${userId}`, 60, 3_600_000);
    const existing = await ctx.db
      .query("pledges")
      .withIndex("by_slop_user", (q) => q.eq("slopId", slop._id).eq("userId", userId))
      .unique();
    const previous = existing?.amount ?? 0;
    const backers = slop.backers + (amount > 0 ? 1 : 0) - (previous > 0 ? 1 : 0);
    const pledged = slop.pledged + amount - previous;
    await ctx.db.patch(slop._id, { backers, pledged });
    if (amount === 0 && existing) await ctx.db.delete(existing._id);
    else if (existing) await ctx.db.patch(existing._id, { amount });
    else if (amount > 0) await ctx.db.insert("pledges", { slopId: slop._id, userId, amount });
    if (amount > previous) {
      await notify(ctx, { userId: slop.userId, kind: "pledge", slopId: slop._id, actorId: userId, amount });
    }
    // Who pledged what stays private, here too: only that someone did.
    if (amount !== previous) await captureFor(ctx, userId, { name: "pledged", slopId: slop._id });
    return { backers, pledged, amount };
  },
});

/** Public JSON for one launch (promo video tooling reads this). */
export const publicById = query({
  args: { id: v.string() },
  handler: async (ctx, { id }) => {
    const slopId = ctx.db.normalizeId("slops", id);
    const slop = slopId ? await ctx.db.get(slopId) : null;
    if (!slop || slop.hidden) return null;
    const owner = await ctx.db.get(slop.userId);
    return owner ? { slop: await publicSlop(ctx, slop), owner: publicUser(owner) } : null;
  },
});

/**
 * Just what a share card draws, by username and slug: the page query also
 * gathers updates, launches and money, and card URLs are fetched by every
 * crawler that sees a link, so this one stays light.
 */
export const card = query({
  args: { username: v.string(), slug: v.string() },
  handler: async (ctx, { username, slug }) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username.toLowerCase()))
      .unique();
    if (!owner) return null;
    const slop = await ctx.db
      .query("slops")
      .withIndex("by_user_slug", (q) => q.eq("userId", owner._id).eq("slug", slug))
      .unique();
    if (!slop || slop.hidden) return null;
    return { slop: await publicSlop(ctx, slop), owner: publicUser(owner) };
  },
});

/** Full documents for the server (auto-posting, ownership checks). */
export const getForServer = query({
  args: { slopId: v.id("slops") },
  handler: async (ctx, { slopId }): Promise<Doc<"slops"> | null> => {
    await requireServer(ctx);
    return await ctx.db.get(slopId);
  },
});

export const findForServer = query({
  args: { userId: v.id("users"), ref: v.string() },
  handler: async (ctx, { userId, ref }): Promise<Doc<"slops"> | null> => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("slops", ref);
    const byId = id ? await ctx.db.get(id) : null;
    if (byId) return byId.userId === userId ? byId : null;
    return await ctx.db
      .query("slops")
      .withIndex("by_user_slug", (q) => q.eq("userId", userId).eq("slug", ref))
      .unique();
  },
});

export const listForServer = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Doc<"slops">[]> => {
    await requireServer(ctx);
    return await ctx.db
      .query("slops")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

/**
 * Everything the slop page shows, live: votes, pledges, updates and
 * feedback reach every open copy of the page as they happen. Feedback is
 * left out unless `withComments` asks for it: the app turns comments on
 * and off (COMMENTS_ENABLED), and while they're off none is sent anywhere.
 */
export const page = query({
  args: {
    username: v.string(),
    slug: v.string(),
    asUser: v.optional(v.id("users")),
    withComments: v.optional(v.boolean()),
  },
  handler: async (ctx, { username, slug, asUser, withComments = false }) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username.toLowerCase()))
      .unique();
    if (!owner) return null;
    const slop = await ctx.db
      .query("slops")
      .withIndex("by_user_slug", (q) => q.eq("userId", owner._id).eq("slug", slug))
      .unique();
    if (!slop) return null;
    const reader = await readerFor(ctx, asUser);
    const isOwner = reader?._id === owner._id;
    // Moderators see hidden slops too, to judge them.
    if (slop.hidden && !isOwner && !can(reader, "slops.viewHidden")) return null;

    // Bounded reads: the query is public, and no slop honestly reaches these.
    const updates = await ctx.db
      .query("updates")
      .withIndex("by_slop", (q) => q.eq("slopId", slop._id))
      .order("desc")
      .take(500);
    const comments = withComments
      ? await ctx.db
          .query("comments")
          .withIndex("by_slop", (q) => q.eq("slopId", slop._id))
          .take(500)
      : [];
    const productId = productIdOf(slop);
    const product = await ctx.db.get(productId);
    const later = await ctx.db
      .query("slops")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .take(500);
    const launches = [product, ...later].filter((launch): launch is Doc<"slops"> => launch !== null);
    const moneyPublic = product?.moneyPublic ?? false;
    const ledger =
      isOwner || moneyPublic
        ? await ctx.db
            .query("ledger")
            .withIndex("by_product", (q) => q.eq("productId", productId))
            .order("desc")
            .collect()
        : [];
    const flaggedByMe =
      reader !== null &&
      (await ctx.db
        .query("reports")
        .withIndex("by_slop_reporter", (q) => q.eq("slopId", slop._id).eq("reporterId", reader._id))
        .first()) !== null;
    const myPledge = reader
      ? ((
          await ctx.db
            .query("pledges")
            .withIndex("by_slop_user", (q) => q.eq("slopId", slop._id).eq("userId", reader._id))
            .unique()
        )?.amount ?? 0)
      : 0;

    const authors = new Map<Id<"users">, Doc<"users"> | null>();
    for (const comment of comments) {
      if (!authors.has(comment.userId)) authors.set(comment.userId, await ctx.db.get(comment.userId));
    }

    return {
      owner: publicUser(owner),
      ownerTimeZone: owner.timeZone,
      slop: await publicSlop(ctx, slop),
      descriptionHtml: renderMarkdown(slop.description),
      updates: await Promise.all(
        updates.map(async (update) => ({
          ...(await publicUpdate(ctx, update)),
          // Where it was auto-posted is the owner's business only.
          crossposts: isOwner ? update.crossposts : [],
        })),
      ),
      ...(await reviewsFor(ctx, slop._id, reader)),
      comments: comments.map((comment) => {
        const author = authors.get(comment.userId);
        return {
          id: comment._id,
          kind: comment.kind,
          html: renderMarkdown(comment.body),
          createdAt: comment._creationTime,
          author: author ? publicUser(author) : null,
          canDelete: reader !== null && (reader._id === comment.userId || isOwner || can(reader, "comments.deleteAny")),
        };
      }),
      launches: launches
        .filter((launch) => !launch.hidden || isOwner)
        .map((launch) => ({
          id: launch._id,
          title: launch.launchLabel ?? "First launch",
          number: launch.number,
          launchDate: launch.launchDate,
          upvotes: launch.upvotes,
          slopOfTheDay: launch.slopOfTheDay,
          slug: launch.slug,
        })),
      // Days are UTC dates; a page a day out of date still shows the right 90.
      traction: await tractionFor(ctx, productId, isOwner, new Date().toISOString().slice(0, 10)),
      money: {
        isPublic: moneyPublic,
        totals: moneyTotals(ledger),
        // Line items stay with the owner; everyone else sees totals at most.
        entries: isOwner
          ? ledger.map((entry) => ({
              id: entry._id,
              kind: entry.kind,
              amount: entry.amount,
              currency: entry.currency,
              category: entry.category,
              note: entry.note,
              date: entry.date,
            }))
          : [],
      },
      vote: reader ? await voteOf(ctx, slop._id, reader._id) : 0,
      voteMode: !reader ? ("login" as const) : isOwner ? ("own" as const) : ("vote" as const),
      myPledge,
      flaggedByMe,
      // Only the owner and moderators ever load a hidden slop.
      heldForReview: slop.hidden && slop.check?.verdict === "blocked",
      isOwner,
      reveal: !slop.nsfw || isOwner || reader?.showNsfw === true,
    };
  },
});

/** The freshest slops in `category`, or in every category when it's null. */
function freshest(ctx: QueryCtx, category: string | null, before: number | null) {
  if (category === null) {
    return ctx.db
      .query("slops")
      .withIndex("by_creation_time", (q) => (before === null ? q : q.lt("_creationTime", before)))
      .order("desc");
  }
  return ctx.db
    .query("slops")
    .withIndex("by_category", (q) =>
      before === null ? q.eq("category", category) : q.eq("category", category).lt("_creationTime", before),
    )
    .order("desc");
}

/**
 * Newest first, in any of `categories` (every one when empty), a page at a
 * time. Each category is its own index range, so picking several reads no
 * slop outside them. The cursor is the last slop's creation time; pass it
 * back as `before` for the next page.
 */
export const recent = query({
  args: {
    categories: v.optional(v.array(v.string())),
    before: v.union(v.number(), v.null()),
    limit: v.number(),
    asUser: v.optional(v.id("users")),
  },
  handler: async (ctx, { categories = [], before, limit, asUser }) => {
    const reader = await readerFor(ctx, asUser);
    const size = Math.min(limit, 48);
    const filter = categoryFilter(categories);
    const scopes = filter.length > 0 ? filter : [null];
    // One more than a page from each, to tell whether anything is left.
    const ranges = await Promise.all(scopes.map((category) => freshest(ctx, category, before).take(size + 1)));
    const newest = ranges.flat().sort((a, b) => b._creationTime - a._creationTime);
    const page = newest.slice(0, size);
    return {
      items: await toCards(
        ctx,
        page.filter((slop) => !slop.hidden),
        reader,
      ),
      cursor: newest.length > size ? page[page.length - 1]._creationTime : null,
    };
  },
});

/** How many recent slops "Sticking" ranks, shared between the picked categories. */
const HOT_POOL = 400;

/** Recently active slops in any of `categories` (every one when empty), ranked by heat (votes, feedback, field tests, recency). */
export const hot = query({
  args: {
    since: v.number(),
    categories: v.optional(v.array(v.string())),
    limit: v.number(),
    asUser: v.optional(v.id("users")),
  },
  handler: async (ctx, { since, categories = [], limit, asUser }) => {
    const reader = await readerFor(ctx, asUser);
    const filter = categoryFilter(categories);
    const scopes = filter.length > 0 ? filter : [null];
    const share = Math.ceil(HOT_POOL / scopes.length);
    const ranges = await Promise.all(
      scopes.map((category) =>
        (category === null
          ? ctx.db.query("slops").withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
          : ctx.db
              .query("slops")
              .withIndex("by_category", (q) => q.eq("category", category).gte("_creationTime", since))
        )
          .order("desc")
          .take(share),
      ),
    );
    const pool = ranges.flat().filter((slop) => !slop.hidden);
    return await toCards(ctx, rankHot(pool, new Date()).slice(0, limit), reader);
  },
});

/** The slopcessful hall of fame, newest breakout first. */
export const slopcessful = query({
  args: { limit: v.optional(v.number()), asUser: v.optional(v.id("users")) },
  handler: async (ctx, { limit, asUser }) => {
    const reader = await readerFor(ctx, asUser);
    const slops = await ctx.db
      .query("slops")
      .withIndex("by_slopcessful", (q) => q.gt("slopcessfulAt", 0))
      .order("desc")
      .take(limit ?? 100);
    return await toCards(
      ctx,
      slops.filter((slop) => isVisibleTo(slop, reader) && !slop.hidden),
      reader,
    );
  },
});
