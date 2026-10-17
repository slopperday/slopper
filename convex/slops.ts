import { ConvexError, type Infer, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { readerFor, requireServer } from "./lib/auth";
import { notify } from "./lib/notify";
import { consume, nextCounter } from "./lib/rate";
import { isVisibleTo, productIdOf, publicSlop, publicUpdate, publicUser, toCards, voteOf } from "./lib/shape";
import { linkValidator } from "./schema";
import { openGoal } from "./goals";
import { utcToday } from "./race";
import { isVideo, releaseMedia, updateMedia } from "./lib/media";
import { checkScreenshots } from "./moderation";
import { goalDayFor } from "../app/lib/goal";
import { LIMITS } from "../app/lib/model";
import { renderMarkdown } from "../app/lib/markdown";
import { rankHot } from "../app/lib/ranking";
import { moneyTotals } from "../app/lib/money";
import { slugify } from "../app/lib/username";

export const slopInput = v.object({
  name: v.string(),
  tagline: v.string(),
  description: v.string(),
  category: v.string(),
  links: v.array(linkValidator),
  /** Media ids as typed or sent by an agent; checked against ownership. */
  screenshots: v.array(v.string()),
  madeWith: v.array(v.string()),
});

/**
 * Keeps only media the user uploaded (or already attached), in order, up to
 * `max`. Orphaned media is on its way out.
 */
export async function ownedMedia(
  ctx: QueryCtx,
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
    // Videos go through set_video and a moderator, never in as screenshots.
    if (media?.ownerId === userId && media.orphanedAt === undefined && !isVideo(media)) kept.push(id);
  }
  return kept.slice(0, max);
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

/** A launch ready to go out, its screenshots already checked as the owner's. */
export interface LaunchDraft {
  userId: Id<"users">;
  input: Omit<SlopInput, "screenshots">;
  screenshots: Id<"media">[];
  launchNote: string;
  /** For another launch of a product: one of its earlier launches. */
  source: Doc<"slops"> | null;
  launchLabel: string | null;
  /** Calendar date in the owner's time zone. */
  today: string;
}

/**
 * Puts a launch out: counts it towards the open goal, enters it in today's
 * race and posts its launch note as the first update.
 */
export async function insertLaunch(ctx: MutationCtx, draft: LaunchDraft) {
  const { userId, input, screenshots, launchNote, source, launchLabel, today } = draft;
  const goal = await openGoal(ctx, userId, today);
  const goalDay = goal ? goalDayFor(goal, today) : null;
  const slug = await freeSlug(ctx, userId, slugify(source ? `${input.name} ${launchLabel}` : input.name));
  const now = Date.now();
  const slopId = await ctx.db.insert("slops", {
    userId,
    productId: source ? productIdOf(source) : null,
    launchLabel: source ? (launchLabel ?? "").trim().slice(0, LIMITS.launchLabelLength) : null,
    slug,
    ...input,
    // Set by the content check, flags or moderators; never by the maker.
    nsfw: false,
    screenshots,
    launchDate: today,
    raceDate: new Date(now).toISOString().slice(0, 10),
    goalId: goalDay && goal ? goal._id : null,
    goalDay,
    goalLength: goalDay && goal ? goal.days : null,
    number: await nextCounter(ctx, "slops"),
    upvotes: 0,
    downvotes: 0,
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
  const blurred = await checkScreenshots(ctx, slopId, screenshots);
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
    /** Calendar date in the owner's time zone, computed by the server. */
    today: v.string(),
    relaunchOf: v.optional(v.id("slops")),
    launchLabel: v.optional(v.string()),
  },
  handler: async (ctx, { userId, input, launchNote, today, relaunchOf, launchLabel }) => {
    await requireServer(ctx);
    await consume(ctx, `ship:${userId}`, 20, 86_400_000);
    const source = relaunchOf ? await ownSlop(ctx, userId, relaunchOf) : null;
    if (source && !launchLabel?.trim())
      throw new ConvexError("Say what's launching: a platform, a version, a new app.");
    const { screenshots, ...fields } = input;
    return await insertLaunch(ctx, {
      userId,
      input: fields,
      screenshots: await ownedMedia(ctx, userId, screenshots, source?.screenshots),
      launchNote,
      source,
      launchLabel: launchLabel ?? null,
      today,
    });
  },
});

export const edit = mutation({
  args: { userId: v.id("users"), slopId: v.id("slops"), input: slopInput },
  handler: async (ctx, { userId, slopId, input }) => {
    await requireServer(ctx);
    const slop = await ownSlop(ctx, userId, slopId);
    const screenshots = await ownedMedia(ctx, userId, input.screenshots, slop.screenshots);
    await ctx.db.patch(slopId, { ...input, screenshots });
    const blurred = await checkScreenshots(ctx, slopId, screenshots, slop.screenshots);
    const dropped = slop.screenshots.filter((id) => !screenshots.includes(id));
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

/** Moderation: the server checks the caller is an admin. */
export const setHidden = mutation({
  args: { slopId: v.id("slops"), hidden: v.boolean() },
  handler: async (ctx, { slopId, hidden }) => {
    await requireServer(ctx);
    await ctx.db.patch(slopId, { hidden });
    if (hidden) {
      const reports = await ctx.db
        .query("reports")
        .withIndex("by_slop", (q) => q.eq("slopId", slopId))
        .collect();
      for (const report of reports) await ctx.db.delete(report._id);
    }
  },
});

/** Scrapes a launch off the wall with everything attached to it. */
export const remove = mutation({
  args: { slopId: v.id("slops"), byUserId: v.id("users"), asAdmin: v.boolean() },
  handler: async (ctx, { slopId, byUserId, asAdmin }) => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop) return { orphaned: 0 };
    if (slop.userId !== byUserId && !asAdmin) throw new ConvexError("That slop isn't yours.");
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
    const reports = await ctx.db
      .query("reports")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .collect();
    for (const row of reports) await ctx.db.delete(row._id);
    for (const table of ["votes", "pledges"] as const) {
      const rows = await ctx.db
        .query(table)
        .withIndex("by_slop_user", (q) => q.eq("slopId", slopId))
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    }
    if (slop.productId === null) {
      const ledger = await ctx.db
        .query("ledger")
        .withIndex("by_product", (q) => q.eq("productId", slopId))
        .collect();
      for (const entry of ledger) await ctx.db.delete(entry._id);
    }
    for (const review of await ctx.db
      .query("videoReviews")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .collect()) {
      await ctx.db.delete(review._id);
    }
    await ctx.db.delete(slopId);
    const media = [...slop.screenshots, ...(slop.video ? [slop.video.mediaId] : []), ...updateImages];
    return { orphaned: await releaseMedia(ctx, slop.userId, media) };
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
 * Counters move in the same transaction, and upvotes notify the owner.
 */
export const vote = mutation({
  args: { userId: v.id("users"), slopId: v.string(), value: v.union(v.literal(1), v.literal(-1), v.literal(0)) },
  handler: async (ctx, { userId, slopId: rawId, value }) => {
    await requireServer(ctx);
    const slopId = ctx.db.normalizeId("slops", rawId);
    const slop = slopId ? await ctx.db.get(slopId) : null;
    if (!slop || slop.hidden) throw new ConvexError("Slop not found.");
    if (slop.userId === userId) throw new ConvexError("You can't vote on your own slop.");
    await consume(ctx, `vote:${userId}`, 120, 3_600_000);
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
    await ctx.db.patch(slop._id, { upvotes, downvotes });
    if (value === 0 && existing) await ctx.db.delete(existing._id);
    else if (existing && value !== 0) await ctx.db.patch(existing._id, { value, castOn: today });
    else if (value !== 0) await ctx.db.insert("votes", { slopId: slop._id, userId, value, castOn: today });
    if (value === 1) {
      await notify(ctx, { userId: slop.userId, kind: "upvote", slopId: slop._id, actorId: userId, amount: null });
    }
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
    isAdmin: v.optional(v.boolean()),
    withComments: v.optional(v.boolean()),
  },
  handler: async (ctx, { username, slug, asUser, isAdmin = false, withComments = false }) => {
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
    if (slop.hidden && !isOwner && !isAdmin) return null;

    const updates = await ctx.db
      .query("updates")
      .withIndex("by_slop", (q) => q.eq("slopId", slop._id))
      .order("desc")
      .collect();
    const comments = withComments
      ? await ctx.db
          .query("comments")
          .withIndex("by_slop", (q) => q.eq("slopId", slop._id))
          .collect()
      : [];
    const productId = productIdOf(slop);
    const product = await ctx.db.get(productId);
    const later = await ctx.db
      .query("slops")
      .withIndex("by_product", (q) => q.eq("productId", productId))
      .collect();
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
      comments: comments.map((comment) => {
        const author = authors.get(comment.userId);
        return {
          id: comment._id,
          kind: comment.kind,
          html: renderMarkdown(comment.body),
          createdAt: comment._creationTime,
          author: author ? publicUser(author) : null,
          canDelete: reader !== null && (reader._id === comment.userId || isOwner || isAdmin),
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

/** Newest first, optionally one category, paginated by cursor. */
export const recent = query({
  args: {
    category: v.optional(v.string()),
    cursor: v.union(v.string(), v.null()),
    limit: v.number(),
    asUser: v.optional(v.id("users")),
  },
  handler: async (ctx, { category, cursor, limit, asUser }) => {
    const reader = await readerFor(ctx, asUser);
    const base = category
      ? ctx.db.query("slops").withIndex("by_category", (q) => q.eq("category", category))
      : ctx.db.query("slops");
    const page = await base.order("desc").paginate({ cursor, numItems: Math.min(limit, 48) });
    return {
      items: await toCards(
        ctx,
        page.page.filter((slop) => !slop.hidden),
        reader,
      ),
      cursor: page.isDone ? null : page.continueCursor,
    };
  },
});

/** Recently active slops, ranked by heat (votes, feedback, field tests, recency). */
export const hot = query({
  args: {
    since: v.number(),
    category: v.optional(v.string()),
    limit: v.number(),
    asUser: v.optional(v.id("users")),
  },
  handler: async (ctx, { since, category, limit, asUser }) => {
    const reader = await readerFor(ctx, asUser);
    const slops = await ctx.db
      .query("slops")
      .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
      .order("desc")
      .take(400);
    const pool = slops.filter((slop) => !slop.hidden && (!category || slop.category === category));
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
