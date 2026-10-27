import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireServer } from "./lib/auth";
import {
  isImage,
  isPublication,
  mediaPublicBase,
  mediaUrl,
  publicationFormat,
  publicationName,
  releaseMedia,
} from "./lib/media";
import { consume } from "./lib/rate";
import { mediaCheckValidator, mediaLocationValidator } from "./schema";

/**
 * Screenshots. The app server checks the bytes (type, size, the content
 * check), stores them in a Backblaze B2 bucket (or Convex file storage when
 * B2 isn't configured), then registers who owns them here
 * (app/.server/media.ts).
 */

/** Before an upload is checked or stored: the rate limit, and whether its URLs would work. */
export const beginUpload = mutation({
  args: { userId: v.id("users"), backend: v.union(v.literal("convex"), v.literal("b2")) },
  handler: async (ctx, { userId, backend }) => {
    await requireServer(ctx);
    if (backend === "b2" && !mediaPublicBase()) {
      // A deployment mistake, not the uploader's: a plain Error is logged, and the page gets a server error.
      throw new Error("MEDIA_PUBLIC_URL isn't set on this Convex deployment, so B2 images would have no URL.");
    }
    // Checked uploads cost a model call each, so the limit comes first.
    await consume(ctx, `upload:${userId}`, 60, 3_600_000);
  },
});

/** For Convex file storage only: where the app server posts the bytes. */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireServer(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const register = mutation({
  args: {
    ownerId: v.id("users"),
    location: mediaLocationValidator,
    contentType: v.string(),
    size: v.number(),
    check: mediaCheckValidator,
    /** A publication's file name, as it's shown on its slop. */
    fileName: v.optional(v.string()),
  },
  handler: async (ctx, { ownerId, location, contentType, size, check, fileName }) => {
    await requireServer(ctx);
    if (location.backend === "convex" && !(await ctx.db.system.get(location.storageId))) {
      throw new ConvexError("Upload not found.");
    }
    const mediaId = await ctx.db.insert("media", {
      ownerId,
      contentType,
      size,
      check,
      ...(fileName ? { fileName } : {}),
      ...location,
      attached: false,
    });
    const media = await ctx.db.get(mediaId);
    return { mediaId, url: media ? await mediaUrl(ctx, media) : null };
  },
});

/**
 * Resolves media from an already-authorized server record for content checks
 * and auto-posting. Untrusted submitted ids must use `imageForOwner` instead.
 */
export const url = query({
  args: { mediaId: v.string() },
  handler: async (ctx, { mediaId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("media", mediaId);
    const media = id ? await ctx.db.get(id) : null;
    return media ? await mediaUrl(ctx, media) : null;
  },
});

/** Resolves a submitted image only for its owner; server authority alone doesn't authorize a form id. */
export const imageForOwner = query({
  args: { ownerId: v.id("users"), mediaId: v.string() },
  handler: async (ctx, { ownerId, mediaId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("media", mediaId);
    const media = id ? await ctx.db.get(id) : null;

    if (!media || media.ownerId !== ownerId || !isImage(media)) return null;

    return await mediaUrl(ctx, media);
  },
});

/**
 * Resolves a submitted publication for its owner's form, including its
 * private name and size. The owner comes from the authenticated app session.
 */
export const publication = query({
  args: { ownerId: v.id("users"), mediaId: v.string() },
  handler: async (ctx, { ownerId, mediaId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("media", mediaId);
    const media = id ? await ctx.db.get(id) : null;

    if (!media || media.ownerId !== ownerId || !isPublication(media)) return null;

    const url = await mediaUrl(ctx, media);
    const format = publicationFormat(media.contentType);
    return url && format ? { id: media._id, fileName: publicationName(media), format, size: media.size, url } : null;
  },
});

/** What the launch check needs to read a publication again: where it is and what the upload check said. */
export const publicationForCheck = query({
  args: { mediaId: v.id("media") },
  handler: async (ctx, { mediaId }) => {
    await requireServer(ctx);
    const media = await ctx.db.get(mediaId);
    if (!media || !isPublication(media)) return null;
    const url = await mediaUrl(ctx, media);
    return url
      ? { url, fileName: publicationName(media), contentType: media.contentType, verdict: media.check?.verdict ?? null }
      : null;
  },
});

/** B2 objects no slop shows any more, oldest first, for the app server to delete. */
export const orphans = query({
  args: { limit: v.number() },
  handler: async (ctx, { limit }) => {
    await requireServer(ctx);
    const rows = await ctx.db
      .query("media")
      .withIndex("by_orphaned", (q) => q.gt("orphanedAt", 0))
      .take(Math.min(limit, 100));
    return rows.flatMap((media) => (media.backend === "b2" ? [{ id: media._id, key: media.key }] : []));
  },
});

/** How long an upload has to be attached to something before the sweep takes it. */
const ATTACH_GRACE_MS = 14 * 86_400_000;
/** Unattached media checked per run; each costs a look at its owner's content. */
const SWEEP_PAGE = 50;

/**
 * Uploads nothing ever shows — an abandoned form, or an account filling
 * storage on purpose — are let go of after `ATTACH_GRACE_MS`, through the
 * same still-shown check as any other release (`releaseMedia`). Runs from a
 * cron and keeps going while there's more, so a flood of uploads can't outgrow
 * the sweep.
 */
export const sweepUnattached = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - ATTACH_GRACE_MS;
    const rows = await ctx.db
      .query("media")
      .withIndex("by_attached", (q) => q.eq("attached", false))
      .take(SWEEP_PAGE);
    const stale = rows.filter((row) => row._creationTime < cutoff);
    const byOwner = new Map<Id<"users">, Id<"media">[]>();
    for (const row of stale) byOwner.set(row.ownerId, [...(byOwner.get(row.ownerId) ?? []), row._id]);
    for (const [ownerId, ids] of byOwner) await releaseMedia(ctx, ownerId, ids);
    // The index orders by id, so a full page of stale rows means older ones
    // are still waiting behind it.
    if (rows.length === SWEEP_PAGE && stale.length === rows.length) {
      await ctx.scheduler.runAfter(0, internal.media.sweepUnattached, {});
    }
  },
});

/** Drops the rows of orphaned B2 objects the app server has deleted. */
export const forget = mutation({
  args: { ids: v.array(v.id("media")) },
  handler: async (ctx, { ids }) => {
    await requireServer(ctx);
    for (const id of ids) {
      const media = await ctx.db.get(id);
      if (media?.backend === "b2" && media.orphanedAt !== undefined) await ctx.db.delete(id);
    }
  },
});
