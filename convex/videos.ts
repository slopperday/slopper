import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { isVideo, mediaUrl, releaseMedia } from "./lib/media";

/**
 * A slop's promo video. The content check reads images, not video, so a new
 * video waits in `videoReviews` until a moderator approves it at /mod. Until
 * then it has no public URL; only its owner is told it's waiting.
 */

export type VideoStatus = "none" | "pending" | "live";

/** Attaches an uploaded video to a slop, replacing its last one, or removes it with null. */
export const set = mutation({
  args: { userId: v.id("users"), slopId: v.id("slops"), mediaId: v.union(v.string(), v.null()) },
  handler: async (ctx, { userId, slopId, mediaId }): Promise<{ status: VideoStatus; orphaned: number }> => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop || slop.userId !== userId) throw new ConvexError("Slop not found.");
    let next: Id<"media"> | null = null;
    if (mediaId !== null) {
      const id = ctx.db.normalizeId("media", mediaId);
      const media = id ? await ctx.db.get(id) : null;
      if (!media || media.ownerId !== userId || media.orphanedAt !== undefined || !isVideo(media)) {
        throw new ConvexError("That isn't one of your uploaded videos.");
      }
      next = media._id;
    }
    const previous = slop.video?.mediaId ?? null;
    if (previous === next) {
      return { status: !slop.video ? "none" : slop.video.approvedAt === null ? "pending" : "live", orphaned: 0 };
    }

    const reviews = await ctx.db
      .query("videoReviews")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .collect();
    for (const review of reviews) await ctx.db.delete(review._id);
    if (next) {
      await ctx.db.patch(slopId, { video: { mediaId: next, approvedAt: null } });
      await ctx.db.insert("videoReviews", { slopId, mediaId: next });
    } else {
      await ctx.db.patch(slopId, { video: undefined });
    }
    // After the patch, so the replaced video no longer counts as shown.
    const orphaned = previous ? await releaseMedia(ctx, userId, [previous]) : 0;
    return { status: next ? "pending" : "none", orphaned };
  },
});

/** Videos waiting for a moderator, oldest first, with the URL to watch each one. */
export const queue = query({
  args: {},
  handler: async (ctx) => {
    await requireServer(ctx);
    const reviews = await ctx.db.query("videoReviews").order("asc").take(50);
    const items = [];
    for (const review of reviews) {
      const slop = await ctx.db.get(review.slopId);
      const media = await ctx.db.get(review.mediaId);
      const owner = slop ? await ctx.db.get(slop.userId) : null;
      const url = media ? await mediaUrl(ctx, media) : null;
      if (!slop || !owner || !url) continue;
      items.push({
        slopId: slop._id,
        name: slop.name,
        slug: slop.slug,
        owner: owner.username,
        url,
        submittedAt: review._creationTime,
      });
    }
    return items;
  },
});

/** A moderator's call: approve plays the video for everyone; anything else takes it off the slop. */
export const decide = mutation({
  args: { slopId: v.id("slops"), approve: v.boolean() },
  handler: async (ctx, { slopId, approve }): Promise<{ decided: boolean; orphaned: number }> => {
    await requireServer(ctx);
    const review = await ctx.db
      .query("videoReviews")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .first();
    const slop = await ctx.db.get(slopId);
    if (!review || !slop?.video || slop.video.mediaId !== review.mediaId) return { decided: false, orphaned: 0 };
    await ctx.db.delete(review._id);
    if (approve) {
      await ctx.db.patch(slopId, { video: { mediaId: review.mediaId, approvedAt: Date.now() } });
      return { decided: true, orphaned: 0 };
    }
    await ctx.db.patch(slopId, { video: undefined });
    return { decided: true, orphaned: await releaseMedia(ctx, slop.userId, [review.mediaId]) };
  },
});
