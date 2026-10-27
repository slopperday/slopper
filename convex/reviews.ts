import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type QueryCtx, query } from "./_generated/server";
import { captureFor } from "./analytics";
import { requireServer } from "./lib/auth";
import { releaseMedia } from "./lib/media";
import { notify } from "./lib/notify";
import { can } from "./lib/permissions";
import { consume } from "./lib/rate";
import { screenshotUrls } from "./lib/shape";
import { logStaffAction } from "./lib/staffLog";
import { reviewCheckValidator, reviewExperienceValidator } from "./schema";
import { ownedMedia } from "./slops";
import { LIMITS } from "../app/lib/model";

/**
 * Reviews: people who tried a slop say how it went, with screenshots. The
 * app server runs the content check first (app/.server/reviews.ts) and
 * refuses a blocked one, so what reaches `save` goes up at once.
 */

async function reviewOf(ctx: QueryCtx, slopId: Id<"slops">, userId: Id<"users">): Promise<Doc<"reviews"> | null> {
  return await ctx.db
    .query("reviews")
    .withIndex("by_slop_user", (q) => q.eq("slopId", slopId).eq("userId", userId))
    .unique();
}

/** A slop someone else can review: it exists, isn't hidden, and isn't theirs. */
async function reviewable(ctx: QueryCtx, rawId: string, userId: Id<"users">): Promise<Doc<"slops">> {
  const slopId = ctx.db.normalizeId("slops", rawId);
  const slop = slopId ? await ctx.db.get(slopId) : null;
  if (!slop || slop.hidden) throw new ConvexError("Slop not found.");
  if (slop.userId === userId) throw new ConvexError("You can't review your own slop. Post an update instead.");
  return slop;
}

/** Charge every moderation attempt, including blocked reviews and failed checks. */
export const begin = mutation({
  args: { userId: v.id("users"), slopId: v.string() },
  handler: async (ctx, { userId, slopId }) => {
    await requireServer(ctx);
    await reviewable(ctx, slopId, userId);
    await consume(ctx, `review:${userId}`, 20, 86_400_000);
  },
});

/**
 * Writes the reviewer's review of a slop, or replaces the one they wrote
 * before. Images are kept only if the reviewer uploaded them; a mature image
 * makes the whole review mature. Returns how many dropped images wait for
 * `deleteOrphanedMedia`. Only the app server can save: `postReview` charges
 * the attempt through `begin` before checking it, so saving doesn't charge twice.
 */
export const save = mutation({
  args: {
    userId: v.id("users"),
    slopId: v.string(),
    experience: reviewExperienceValidator,
    body: v.string(),
    /** Media ids as uploaded or sent by an agent; checked against ownership. */
    images: v.array(v.string()),
    check: reviewCheckValidator,
  },
  handler: async (ctx, { userId, slopId: rawId, experience, body, images, check }) => {
    await requireServer(ctx);
    if (!body.trim() || body.length > LIMITS.reviewLength) {
      throw new ConvexError(`A review is 1 to ${LIMITS.reviewLength} characters.`);
    }
    const slop = await reviewable(ctx, rawId, userId);
    const existing = await reviewOf(ctx, slop._id, userId);
    const kept = await ownedMedia(ctx, userId, images, existing?.images ?? [], LIMITS.reviewImages);
    let verdict = check.verdict;
    for (const id of kept) {
      if ((await ctx.db.get(id))?.check?.verdict === "mature") verdict = "mature";
    }
    const fields = { experience, body, images: kept, check: { verdict, reason: check.reason.slice(0, 300) } };

    if (existing) {
      await ctx.db.patch(existing._id, { ...fields, editedAt: Date.now() });
      const dropped = existing.images.filter((id) => !kept.includes(id));
      return { reviewId: existing._id, created: false, orphaned: await releaseMedia(ctx, userId, dropped) };
    }
    const reviewId = await ctx.db.insert("reviews", { slopId: slop._id, userId, ...fields, editedAt: null });
    await ctx.db.patch(slop._id, { lastActivityAt: Date.now() });
    await notify(ctx, { userId: slop.userId, kind: "review", slopId: slop._id, actorId: userId, amount: null });
    await captureFor(ctx, userId, { name: "reviewed", slopId: slop._id, properties: { experience } });
    return { reviewId, created: true, orphaned: 0 };
  },
});

/**
 * Deletes a review. Its author may; so may admins, and the staff log records
 * it. Makers can't delete reviews of their own slops. Returns how many of its
 * images wait for `deleteOrphanedMedia`.
 */
export const remove = mutation({
  args: { userId: v.id("users"), reviewId: v.string() },
  handler: async (ctx, { userId, reviewId: rawId }) => {
    await requireServer(ctx);
    const reviewId = ctx.db.normalizeId("reviews", rawId);
    const review = reviewId ? await ctx.db.get(reviewId) : null;
    if (!review) return { orphaned: 0 };
    if (review.userId !== userId) {
      if (!can(await ctx.db.get(userId), "reviews.deleteAny")) throw new ConvexError("That isn't yours to delete.");
      const slop = await ctx.db.get(review.slopId);
      if (slop) {
        await logStaffAction(ctx, userId, { type: "deleteReview", slopId: slop._id, authorId: review.userId }, slop);
      }
    }
    await ctx.db.delete(review._id);
    return { orphaned: await releaseMedia(ctx, review.userId, review.images) };
  },
});

/** A slop's reviews for agents, by its id, newest first. Hidden slops have none to read. */
export const listForServer = query({
  args: { slopId: v.string() },
  handler: async (ctx, { slopId: rawId }) => {
    await requireServer(ctx);
    const slopId = ctx.db.normalizeId("slops", rawId);
    const slop = slopId ? await ctx.db.get(slopId) : null;
    const owner = slop ? await ctx.db.get(slop.userId) : null;
    if (!slop || slop.hidden || !owner) return null;
    const rows = await ctx.db
      .query("reviews")
      .withIndex("by_slop_user", (q) => q.eq("slopId", slop._id))
      .collect();
    rows.sort((a, b) => b._creationTime - a._creationTime);
    const reviews = [];
    for (const row of rows) {
      const author = await ctx.db.get(row.userId);
      reviews.push({
        id: row._id,
        by: author?.username ?? null,
        experience: row.experience,
        /** Markdown, as written. */
        body: row.body,
        screenshots: await screenshotUrls(ctx, row.images),
        mature: row.check.verdict === "mature",
        createdAt: row._creationTime,
        editedAt: row.editedAt,
      });
    }
    return {
      slop: { id: slop._id, name: slop.name, slug: slop.slug, userId: slop.userId, username: owner.username },
      reviews,
    };
  },
});
