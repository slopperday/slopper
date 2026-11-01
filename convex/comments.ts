import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { mayJudge, requirePermission } from "./lib/permissions";
import { consume } from "./lib/rate";
import { logStaffAction } from "./lib/staffLog";
import { notify } from "./lib/notify";
import { FLAGS_TO_BLUR } from "../app/lib/model";

/**
 * Keeping comments civil. A new one is checked before it is saved
 * (app/.server/comments.ts): only an "ok" verdict shows at once. Anything
 * else, and any comment people flag, waits here for a moderator. Approving
 * one trusts its author (convex/schema.ts `commentTrust`): their later
 * comments skip the check and the hourly cap.
 */

type CommentQueueItem = {
  id: Id<"comments">;
  body: string;
  kind: "feedback" | "kudos";
  createdAt: number;
  author: string | null;
  authorId: Id<"users">;
  slopName: string;
  slug: string;
  owner: string;
  hidden: boolean;
  check: { verdict: "ok" | "mature" | "unchecked"; reason: string } | null;
  flags: { id: Id<"commentFlags">; reason: string; by: string | null; at: number }[];
};

async function clearFlags(ctx: MutationCtx, commentId: Id<"comments">): Promise<void> {
  const flags = await ctx.db
    .query("commentFlags")
    .withIndex("by_comment", (q) => q.eq("commentId", commentId))
    .collect();
  for (const flag of flags) await ctx.db.delete(flag._id);
}

/**
 * A signed-in person flags a comment. Enough different people hide it until a
 * moderator decides. One flag each: flagging again changes nothing.
 */
export const flag = mutation({
  args: { userId: v.id("users"), commentId: v.string(), reason: v.string() },
  handler: async (ctx, { userId, commentId: rawId, reason }) => {
    await requireServer(ctx);
    const commentId = ctx.db.normalizeId("comments", rawId);
    const comment = commentId ? await ctx.db.get(commentId) : null;
    if (!comment || comment.hidden === true) throw new ConvexError("That comment is gone.");
    if (comment.userId === userId) throw new ConvexError("You can't flag your own comment.");
    const existing = await ctx.db
      .query("commentFlags")
      .withIndex("by_comment_reporter", (q) => q.eq("commentId", comment._id).eq("reporterId", userId))
      .first();
    if (existing) return;
    await consume(ctx, `flag-comment:${userId}`, 20, 86_400_000);
    await ctx.db.insert("commentFlags", {
      commentId: comment._id,
      reporterId: userId,
      reason: reason.trim().slice(0, 500) || "Inappropriate",
    });
    const people = new Set(
      (
        await ctx.db
          .query("commentFlags")
          .withIndex("by_comment", (q) => q.eq("commentId", comment._id))
          .collect()
      ).map((flag) => flag.reporterId),
    );
    if (people.size >= FLAGS_TO_BLUR) {
      const slop = await ctx.db.get(comment.slopId);
      await ctx.db.patch(comment._id, { hidden: true });
      if (slop) await ctx.db.patch(slop._id, { commentCount: Math.max(0, slop.commentCount - 1) });
    }
  },
});

/**
 * Comments waiting for a moderator: held by the content check, or flagged by
 * people. Newest first. Moderators only (checked by the server).
 */
export const queue = query({
  args: {},
  handler: async (ctx): Promise<CommentQueueItem[]> => {
    await requireServer(ctx);
    const hidden = await ctx.db
      .query("comments")
      .withIndex("by_hidden", (q) => q.eq("hidden", true))
      .order("desc")
      .take(500);
    const flags = await ctx.db.query("commentFlags").order("desc").take(500);
    const ids = new Map<Id<"comments">, Id<"comments">>();
    for (const comment of hidden) ids.set(comment._id, comment._id);
    for (const flag of flags) ids.set(flag.commentId, flag.commentId);

    const items: CommentQueueItem[] = [];
    for (const id of ids.values()) {
      const comment = await ctx.db.get(id);
      if (!comment) continue;
      const slop = await ctx.db.get(comment.slopId);
      const owner = slop ? await ctx.db.get(slop.userId) : null;
      if (!slop || !owner) continue;
      const author = await ctx.db.get(comment.userId);
      const rows = await ctx.db
        .query("commentFlags")
        .withIndex("by_comment", (q) => q.eq("commentId", id))
        .order("desc")
        .collect();
      const reporters = await Promise.all(rows.map((row) => ctx.db.get(row.reporterId)));
      items.push({
        id: comment._id,
        body: comment.body,
        kind: comment.kind,
        createdAt: comment._creationTime,
        author: author?.username ?? null,
        authorId: comment.userId,
        slopName: slop.name,
        slug: slop.slug,
        owner: owner.username,
        hidden: comment.hidden === true,
        check: comment.check ? { verdict: comment.check.verdict, reason: comment.check.reason } : null,
        flags: rows.map((row, index) => ({
          id: row._id,
          reason: row.reason,
          by: reporters[index]?.username ?? null,
          at: row._creationTime,
        })),
      });
    }
    return items.sort((a, b) => b.createdAt - a.createdAt);
  },
});

/**
 * A moderator's call on a waiting comment. "approve" puts it up and trusts its
 * author; "remove" deletes it. Either way its flags close, and the staff log
 * records it. Moderators don't decide on their own comments.
 */
export const decide = mutation({
  args: {
    moderatorId: v.id("users"),
    commentId: v.string(),
    decision: v.union(v.literal("approve"), v.literal("remove")),
  },
  handler: async (
    ctx,
    { moderatorId, commentId: rawId, decision },
  ): Promise<{ decided: boolean; trusted: boolean }> => {
    await requireServer(ctx);
    const moderator = await requirePermission(ctx, moderatorId, "queue.decide");
    const commentId = ctx.db.normalizeId("comments", rawId);
    const comment = commentId ? await ctx.db.get(commentId) : null;
    if (!comment) return { decided: false, trusted: false };
    const slop = await ctx.db.get(comment.slopId);
    if (!slop) return { decided: false, trusted: false };
    if (!mayJudge(moderator, comment.userId)) {
      throw new ConvexError("That's your comment, so another moderator decides on it.");
    }

    const wasVisible = comment.hidden !== true;
    let trusted = false;
    if (decision === "approve") {
      const now = Date.now();
      await ctx.db.patch(comment._id, {
        hidden: false,
        check: {
          verdict: "ok",
          reason: "Approved by a moderator.",
          source: "moderator",
          checkedAt: now,
        },
      });
      if (!wasVisible) await ctx.db.patch(slop._id, { commentCount: slop.commentCount + 1 });
      if (comment.userId !== slop.userId && comment.notified !== true) {
        await notify(ctx, {
          userId: slop.userId,
          kind: comment.kind,
          slopId: slop._id,
          actorId: comment.userId,
          amount: null,
        });
        await ctx.db.patch(comment._id, { notified: true });
      }
      // A moderator read their words and let them through: they're trusted now.
      const existing = await ctx.db
        .query("commentTrust")
        .withIndex("by_user", (q) => q.eq("userId", comment.userId))
        .unique();
      if (existing) {
        if (!existing.trusted) await ctx.db.patch(existing._id, { trusted: true, by: moderatorId, at: now });
      } else {
        await ctx.db.insert("commentTrust", { userId: comment.userId, trusted: true, by: moderatorId, at: now });
      }
      trusted = true;
    } else {
      if (wasVisible) {
        await ctx.db.patch(slop._id, { commentCount: Math.max(0, slop.commentCount - 1) });
      }
      await ctx.db.delete(comment._id);
    }
    await clearFlags(ctx, comment._id);

    await logStaffAction(
      ctx,
      moderatorId,
      { type: "moderateComment", slopId: slop._id, authorId: comment.userId, decision, trusted },
      slop,
    );
    return { decided: true, trusted };
  },
});
