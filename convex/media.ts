import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { isPublication, mediaPublicBase, mediaUrl, publicationFormat, publicationName } from "./lib/media";
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
    });
    const media = await ctx.db.get(mediaId);
    return { mediaId, url: media ? await mediaUrl(ctx, media) : null };
  },
});

/** Public URL for a stored screenshot. */
export const url = query({
  args: { mediaId: v.string() },
  handler: async (ctx, { mediaId }) => {
    const id = ctx.db.normalizeId("media", mediaId);
    const media = id ? await ctx.db.get(id) : null;
    return media ? await mediaUrl(ctx, media) : null;
  },
});

/** A publication as the slop forms show it: its name, size and where to read it. */
export const publication = query({
  args: { mediaId: v.string() },
  handler: async (ctx, { mediaId }) => {
    const id = ctx.db.normalizeId("media", mediaId);
    const media = id ? await ctx.db.get(id) : null;
    if (!media || !isPublication(media)) return null;
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
