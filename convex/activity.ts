import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { isAdmin, requireServer } from "./lib/auth";
import { notify } from "./lib/notify";
import { consume } from "./lib/rate";
import { crosspostResultValidator } from "./schema";

/** Updates (fixes, features, field tests, re-promotes) and feedback. */

export const addUpdate = mutation({
  args: {
    userId: v.id("users"),
    slopId: v.id("slops"),
    kind: v.union(v.literal("update"), v.literal("feature"), v.literal("field"), v.literal("repromote")),
    body: v.string(),
  },
  handler: async (ctx, { userId, slopId, kind, body }) => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop || slop.userId !== userId) throw new ConvexError("That slop isn't yours.");
    await consume(ctx, `update:${userId}`, 30, 86_400_000);
    await ctx.db.patch(slopId, {
      updateCount: slop.updateCount + 1,
      fieldTests: slop.fieldTests + (kind === "field" ? 1 : 0),
      // Updates bump a slop back up the feeds.
      lastActivityAt: Date.now(),
    });
    return await ctx.db.insert("updates", { slopId, userId, kind, body, crossposts: [] });
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

export const deleteUpdate = mutation({
  args: { userId: v.id("users"), updateId: v.string() },
  handler: async (ctx, { userId, updateId: rawId }) => {
    await requireServer(ctx);
    const updateId = ctx.db.normalizeId("updates", rawId);
    const update = updateId ? await ctx.db.get(updateId) : null;
    if (!update || update.userId !== userId || update.kind === "launch") return;
    const slop = await ctx.db.get(update.slopId);
    if (slop) {
      await ctx.db.patch(slop._id, {
        updateCount: Math.max(0, slop.updateCount - 1),
        fieldTests: Math.max(0, slop.fieldTests - (update.kind === "field" ? 1 : 0)),
      });
    }
    await ctx.db.delete(update._id);
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
  args: { userId: v.id("users"), commentId: v.string() },
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
