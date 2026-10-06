import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { consume } from "./lib/rate";

/**
 * Screenshots live in Convex file storage. The app server checks the bytes
 * (type, size), uploads them, then registers who owns the file.
 */

export const uploadUrl = mutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    await consume(ctx, `upload:${userId}`, 60, 3_600_000);
    return await ctx.storage.generateUploadUrl();
  },
});

export const register = mutation({
  args: { ownerId: v.id("users"), storageId: v.id("_storage") },
  handler: async (ctx, { ownerId, storageId }) => {
    await requireServer(ctx);
    const file = await ctx.db.system.get(storageId);
    if (!file) throw new ConvexError("Upload not found.");
    const mediaId = await ctx.db.insert("media", {
      storageId,
      ownerId,
      contentType: file.contentType ?? "application/octet-stream",
      size: file.size,
    });
    return { mediaId, url: await ctx.storage.getUrl(storageId) };
  },
});

/** Public URL for a stored screenshot. */
export const url = query({
  args: { mediaId: v.string() },
  handler: async (ctx, { mediaId }) => {
    const id = ctx.db.normalizeId("media", mediaId);
    const media = id ? await ctx.db.get(id) : null;
    return media ? await ctx.storage.getUrl(media.storageId) : null;
  },
});
