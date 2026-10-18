import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { isVideo, mediaUrl, releaseMedia } from "./lib/media";
import { requireMayJudge, requirePermission } from "./lib/permissions";
import { logStaffAction } from "./lib/staffLog";
import { videoVerdictValidator } from "./schema";

/**
 * A slop's promo video. A new video waits in `videoReviews` for a moderator,
 * with no public URL until it's approved; only its owner is told it's waiting.
 *
 * Approving someone's video trusts them (`videoTrust`). A trusted uploader's
 * next videos go past the video check as they're set (app/.server/moderation.ts,
 * `checkVideo`): a pass plays at once, and anything else (a mature or blocked
 * verdict, or a check that couldn't run) leaves the video in the queue. Every
 * automatic decision is kept in `videoChecks` for /mod. Admins can revoke trust.
 */

export type VideoStatus = "none" | "pending" | "live";

function statusOf(slop: Doc<"slops">): VideoStatus {
  return !slop.video ? "none" : slop.video.approvedAt === null ? "pending" : "live";
}

async function reviewOf(ctx: QueryCtx, slopId: Id<"slops">): Promise<Doc<"videoReviews"> | null> {
  return await ctx.db
    .query("videoReviews")
    .withIndex("by_slop", (q) => q.eq("slopId", slopId))
    .first();
}

async function trustOf(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"videoTrust"> | null> {
  return await ctx.db
    .query("videoTrust")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** Trusted, revoked, or never decided (null). */
export type TrustState = "trusted" | "revoked" | null;

function trustState(trust: Doc<"videoTrust"> | null): TrustState {
  return trust === null ? null : trust.trusted ? "trusted" : "revoked";
}

/** A trusted uploader's new video, handed to the app server to check. */
export interface VideoToCheck {
  mediaId: Id<"media">;
  url: string;
  contentType: string;
}

/**
 * Attaches an uploaded video to a slop, replacing its last one, or removes it
 * with null. A new video always starts out waiting; when its owner is trusted,
 * `check` asks the app server to run the video check on it.
 */
export const set = mutation({
  args: { userId: v.id("users"), slopId: v.id("slops"), mediaId: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    { userId, slopId, mediaId },
  ): Promise<{ status: VideoStatus; orphaned: number; check: VideoToCheck | null }> => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop || slop.userId !== userId) throw new ConvexError("Slop not found.");
    let next: Doc<"media"> | null = null;
    if (mediaId !== null) {
      const id = ctx.db.normalizeId("media", mediaId);
      const media = id ? await ctx.db.get(id) : null;
      if (!media || media.ownerId !== userId || media.orphanedAt !== undefined || !isVideo(media)) {
        throw new ConvexError("That isn't one of your uploaded videos.");
      }
      next = media;
    }
    const previous = slop.video?.mediaId ?? null;
    if (previous === (next?._id ?? null)) return { status: statusOf(slop), orphaned: 0, check: null };

    const reviews = await ctx.db
      .query("videoReviews")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .collect();
    for (const review of reviews) await ctx.db.delete(review._id);
    let check: VideoToCheck | null = null;
    if (next) {
      await ctx.db.patch(slopId, { video: { mediaId: next._id, approvedAt: null } });
      await ctx.db.insert("videoReviews", { slopId, mediaId: next._id });
      const url = (await trustOf(ctx, userId))?.trusted ? await mediaUrl(ctx, next) : null;
      if (url) check = { mediaId: next._id, url, contentType: next.contentType };
    } else {
      await ctx.db.patch(slopId, { video: undefined });
    }
    // After the patch, so the replaced video no longer counts as shown.
    const orphaned = previous ? await releaseMedia(ctx, userId, [previous]) : 0;
    return { status: next ? "pending" : "none", orphaned, check };
  },
});

/**
 * The video check's answer on a trusted uploader's video. A pass plays it for
 * everyone; anything else leaves it for a moderator. Either way it's recorded.
 * A video replaced since it was handed over is skipped: its replacement gets
 * its own check.
 */
export const recordCheck = mutation({
  args: {
    slopId: v.id("slops"),
    mediaId: v.id("media"),
    verdict: videoVerdictValidator,
    reason: v.string(),
    checker: v.union(v.object({ model: v.string(), provider: v.string() }), v.null()),
  },
  handler: async (ctx, { slopId, mediaId, verdict, reason, checker }): Promise<{ status: VideoStatus }> => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop) return { status: "none" };
    const review = await reviewOf(ctx, slopId);
    if (!review || review.mediaId !== mediaId || slop.video?.mediaId !== mediaId) return { status: statusOf(slop) };
    // Trust can be revoked while the check runs.
    const live = verdict === "ok" && (await trustOf(ctx, slop.userId))?.trusted === true;
    await ctx.db.insert("videoChecks", {
      slopId,
      mediaId,
      ownerId: slop.userId,
      verdict,
      reason: reason.trim().slice(0, 300) || "No reason given",
      checker,
      outcome: live ? "live" : "queued",
    });
    if (!live) return { status: "pending" };
    await ctx.db.delete(review._id);
    await ctx.db.patch(slopId, { video: { mediaId, approvedAt: Date.now() } });
    return { status: "live" };
  },
});

/** What the video check last said about a video, if it ran. */
async function lastCheck(ctx: QueryCtx, slopId: Id<"slops">, mediaId: Id<"media">) {
  const rows = await ctx.db
    .query("videoChecks")
    .withIndex("by_slop", (q) => q.eq("slopId", slopId))
    .order("desc")
    .take(10);
  const row = rows.find((check) => check.mediaId === mediaId);
  return row ? { verdict: row.verdict, reason: row.reason, checker: row.checker, at: row._creationTime } : null;
}

/**
 * Videos waiting for a moderator, oldest first, with the URL to watch each
 * one, whether its owner is trusted, and what the video check said if it ran.
 */
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
        mediaId: review.mediaId,
        name: slop.name,
        slug: slop.slug,
        owner: owner.username,
        ownerId: owner._id,
        trust: trustState(await trustOf(ctx, owner._id)),
        check: await lastCheck(ctx, slop._id, review.mediaId),
        url,
        submittedAt: review._creationTime,
      });
    }
    return items;
  },
});

/**
 * A moderator's call on the video they watched: approve plays it for
 * everyone, anything else takes it off the slop. Approving someone's video
 * for the first time trusts them; a revoked trust stays revoked. Moderators
 * don't decide on their own videos, or they could trust themselves.
 */
export const decide = mutation({
  args: { moderatorId: v.id("users"), slopId: v.id("slops"), mediaId: v.id("media"), approve: v.boolean() },
  handler: async (
    ctx,
    { moderatorId, slopId, mediaId, approve },
  ): Promise<{ decided: boolean; newlyTrusted: boolean; orphaned: number }> => {
    await requireServer(ctx);
    const moderator = await requirePermission(ctx, moderatorId, "queue.decide");
    const review = await reviewOf(ctx, slopId);
    const slop = await ctx.db.get(slopId);
    // A replacement sent since the page loaded waits for its own review.
    if (!review || review.mediaId !== mediaId || slop?.video?.mediaId !== mediaId) {
      return { decided: false, newlyTrusted: false, orphaned: 0 };
    }
    requireMayJudge(moderator, slop);
    await ctx.db.delete(review._id);
    await logStaffAction(ctx, moderatorId, { type: "video", slopId, approved: approve }, slop);
    if (!approve) {
      await ctx.db.patch(slopId, { video: undefined });
      return { decided: true, newlyTrusted: false, orphaned: await releaseMedia(ctx, slop.userId, [mediaId]) };
    }
    await ctx.db.patch(slopId, { video: { mediaId, approvedAt: Date.now() } });
    if (await trustOf(ctx, slop.userId)) return { decided: true, newlyTrusted: false, orphaned: 0 };
    await ctx.db.insert("videoTrust", { userId: slop.userId, trusted: true, by: moderatorId, at: Date.now() });
    return { decided: true, newlyTrusted: true, orphaned: 0 };
  },
});

/** An admin takes a video off its slop, live or waiting: for one the check let through. */
export const takeDown = mutation({
  args: { adminId: v.id("users"), slopId: v.id("slops"), mediaId: v.id("media") },
  handler: async (ctx, { adminId, slopId, mediaId }): Promise<{ removed: boolean; orphaned: number }> => {
    await requireServer(ctx);
    await requirePermission(ctx, adminId, "videos.takeDown");
    const slop = await ctx.db.get(slopId);
    if (!slop?.video || slop.video.mediaId !== mediaId) return { removed: false, orphaned: 0 };
    const reviews = await ctx.db
      .query("videoReviews")
      .withIndex("by_slop", (q) => q.eq("slopId", slopId))
      .collect();
    for (const review of reviews) await ctx.db.delete(review._id);
    await ctx.db.patch(slopId, { video: undefined });
    await logStaffAction(ctx, adminId, { type: "takeDown", slopId }, slop);
    return { removed: true, orphaned: await releaseMedia(ctx, slop.userId, [mediaId]) };
  },
});

/** An admin revokes someone's trust, or gives it back. Returns their username. */
export const setTrust = mutation({
  args: { adminId: v.id("users"), userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { adminId, userId, trusted }): Promise<string> => {
    await requireServer(ctx);
    await requirePermission(ctx, adminId, "videos.trust");
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("That account is gone.");
    const trust = await trustOf(ctx, userId);
    if (trust) await ctx.db.patch(trust._id, { trusted, by: adminId, at: Date.now() });
    else await ctx.db.insert("videoTrust", { userId, trusted, by: adminId, at: Date.now() });
    await logStaffAction(ctx, adminId, { type: "trust", userId, trusted }, user);
    return user.username;
  },
});

/** Everyone a moderator has trusted or revoked, most recent first. */
export const trustList = query({
  args: {},
  handler: async (ctx) => {
    await requireServer(ctx);
    const rows = await ctx.db.query("videoTrust").collect();
    const items = [];
    for (const row of rows.sort((a, b) => b.at - a.at).slice(0, 100)) {
      const user = await ctx.db.get(row.userId);
      if (!user) continue;
      const by = await ctx.db.get(row.by);
      items.push({
        userId: user._id,
        username: user.username,
        trusted: row.trusted,
        by: by?.username ?? null,
        at: row.at,
      });
    }
    return items;
  },
});

/** The latest automatic decisions, newest first, with whether each video still shows. */
export const checks = query({
  args: {},
  handler: async (ctx) => {
    await requireServer(ctx);
    const rows = await ctx.db.query("videoChecks").order("desc").take(30);
    const items = [];
    for (const row of rows) {
      const slop = await ctx.db.get(row.slopId);
      const owner = await ctx.db.get(row.ownerId);
      if (!slop || !owner) continue;
      const showing: "live" | "pending" | "gone" =
        slop.video?.mediaId !== row.mediaId ? "gone" : slop.video.approvedAt === null ? "pending" : "live";
      const media = showing === "gone" ? null : await ctx.db.get(row.mediaId);
      items.push({
        id: row._id,
        slopId: slop._id,
        mediaId: row.mediaId,
        name: slop.name,
        slug: slop.slug,
        owner: owner.username,
        ownerId: owner._id,
        trust: trustState(await trustOf(ctx, owner._id)),
        verdict: row.verdict,
        reason: row.reason,
        checker: row.checker,
        outcome: row.outcome,
        at: row._creationTime,
        showing,
        url: media ? await mediaUrl(ctx, media) : null,
      });
    }
    return items;
  },
});
