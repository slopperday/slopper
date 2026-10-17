import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { isAdmin, requireServer } from "./lib/auth";
import { releaseMedia, updateMedia } from "./lib/media";
import { notify } from "./lib/notify";
import { consume } from "./lib/rate";
import { checkScreenshots } from "./moderation";
import { crosspostResultValidator, updateDetailsValidator, updateLinkValidator } from "./schema";
import { ownedMedia } from "./slops";
import { LIMITS } from "../app/lib/model";

/** Updates (fixes, features, field tests, re-promotes) and feedback. */

/**
 * Posts an update. The app server has validated it (app/.server/forms.ts)
 * and read any link cards the maker asked for; images are kept only if the
 * maker uploaded them, and a mature one blurs the slop like a screenshot.
 */
export const addUpdate = mutation({
  args: {
    userId: v.id("users"),
    slopId: v.id("slops"),
    kind: v.union(v.literal("update"), v.literal("feature"), v.literal("field"), v.literal("repromote")),
    body: v.string(),
    version: v.optional(v.union(v.string(), v.null())),
    /** Media ids as typed or sent by an agent; checked against ownership. */
    images: v.optional(v.array(v.string())),
    links: v.optional(v.array(updateLinkValidator)),
    details: v.optional(v.union(updateDetailsValidator, v.null())),
  },
  handler: async (ctx, { userId, slopId, kind, body, version = null, images = [], links = [], details = null }) => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop || slop.userId !== userId) throw new ConvexError("That slop isn't yours.");
    if (details && details.kind !== kind) throw new ConvexError(`Those details are for a ${details.kind} update.`);
    if (links.length > LIMITS.updateLinks) throw new ConvexError(`Up to ${LIMITS.updateLinks} links.`);
    await consume(ctx, `update:${userId}`, 30, 86_400_000);
    const kept = await ownedMedia(ctx, userId, images, [], LIMITS.updateImages);
    const cards = links.flatMap((link) => (link.preview?.imageId ? [link.preview.imageId] : []));
    const ownedCards = new Set(await ownedMedia(ctx, userId, cards, [], LIMITS.updateLinks));
    await ctx.db.patch(slopId, {
      updateCount: slop.updateCount + 1,
      fieldTests: slop.fieldTests + (kind === "field" ? 1 : 0),
      // Updates bump a slop back up the feeds.
      lastActivityAt: Date.now(),
    });
    const updateId = await ctx.db.insert("updates", {
      slopId,
      userId,
      kind,
      body,
      crossposts: [],
      version,
      images: kept,
      links: links.map((link) =>
        link.preview?.imageId && !ownedCards.has(link.preview.imageId)
          ? { ...link, preview: { ...link.preview, imageId: null } }
          : link,
      ),
      details,
    });
    await checkScreenshots(ctx, slopId, [...kept, ...ownedCards], slop.screenshots);
    return updateId;
  },
});

export const getUpdate = query({
  args: { updateId: v.string() },
  handler: async (ctx, { updateId }): Promise<Doc<"updates"> | null> => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("updates", updateId);
    return id ? await ctx.db.get(id) : null;
  },
});

export const saveCrossposts = mutation({
  args: { updateId: v.id("updates"), crossposts: v.array(crosspostResultValidator) },
  handler: async (ctx, { updateId, crossposts }) => {
    await requireServer(ctx);
    await ctx.db.patch(updateId, { crossposts });
  },
});

/** Deletes one of the owner's updates. Returns how many of its images wait for `deleteOrphanedMedia`. */
export const deleteUpdate = mutation({
  args: { userId: v.id("users"), updateId: v.string() },
  handler: async (ctx, { userId, updateId: rawId }) => {
    await requireServer(ctx);
    const updateId = ctx.db.normalizeId("updates", rawId);
    const update = updateId ? await ctx.db.get(updateId) : null;
    if (!update || update.userId !== userId || update.kind === "launch") return { orphaned: 0 };
    const slop = await ctx.db.get(update.slopId);
    if (slop) {
      await ctx.db.patch(slop._id, {
        updateCount: Math.max(0, slop.updateCount - 1),
        fieldTests: Math.max(0, slop.fieldTests - (update.kind === "field" ? 1 : 0)),
      });
    }
    await ctx.db.delete(update._id);
    return { orphaned: await releaseMedia(ctx, userId, updateMedia(update)) };
  },
});

/**
 * Takes the card off one of an update's links, leaving the plain link.
 * Returns how many images wait for `deleteOrphanedMedia`.
 */
export const removePreview = mutation({
  args: { userId: v.id("users"), updateId: v.string(), url: v.string() },
  handler: async (ctx, { userId, updateId: rawId, url }) => {
    await requireServer(ctx);
    const updateId = ctx.db.normalizeId("updates", rawId);
    const update = updateId ? await ctx.db.get(updateId) : null;
    if (!update || update.userId !== userId) throw new ConvexError("That update isn't yours.");
    const links = update.links ?? [];
    const removed = links.find((link) => link.url === url)?.preview;
    if (!removed) return { orphaned: 0 };
    await ctx.db.patch(update._id, {
      links: links.map((link) => (link.url === url ? { ...link, preview: null } : link)),
    });
    return { orphaned: removed.imageId ? await releaseMedia(ctx, userId, [removed.imageId]) : 0 };
  },
});

export const addComment = mutation({
  args: {
    userId: v.id("users"),
    slopId: v.id("slops"),
    kind: v.union(v.literal("feedback"), v.literal("kudos")),
    body: v.string(),
  },
  handler: async (ctx, { userId, slopId, kind, body }) => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop || slop.hidden) throw new ConvexError("Slop not found.");
    await consume(ctx, `comment:${userId}`, 30, 3_600_000);
    await ctx.db.patch(slopId, { commentCount: slop.commentCount + 1 });
    const commentId = await ctx.db.insert("comments", { slopId, userId, kind, body });
    if (slop.userId !== userId) {
      await notify(ctx, { userId: slop.userId, kind, slopId, actorId: userId, amount: null });
    }
    return commentId;
  },
});

/** Authors, the slop's owner and moderators may delete feedback. */
export const deleteComment = mutation({
  // `asAdmin` is ignored, like `isAdmin` on `slops.page`: only the stored role counts.
  args: { userId: v.id("users"), commentId: v.string(), asAdmin: v.optional(v.boolean()) },
  handler: async (ctx, { userId, commentId: rawId }) => {
    await requireServer(ctx);
    const commentId = ctx.db.normalizeId("comments", rawId);
    const comment = commentId ? await ctx.db.get(commentId) : null;
    if (!comment) return;
    const slop = await ctx.db.get(comment.slopId);
    if (comment.userId !== userId && slop?.userId !== userId && !isAdmin(await ctx.db.get(userId))) {
      throw new ConvexError("That isn't yours to delete.");
    }
    if (slop) await ctx.db.patch(slop._id, { commentCount: Math.max(0, slop.commentCount - 1) });
    await ctx.db.delete(comment._id);
  },
});
