import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/**
 * Where B2 images are served from: the bucket's public URL now, a CDN in
 * front of it later. It's set on the Convex deployment because Convex builds
 * the image URLs that live queries send to browsers; the app server only
 * writes and deletes objects.
 */
export function mediaPublicBase(): string | null {
  return process.env.MEDIA_PUBLIC_URL?.trim().replace(/\/+$/, "") || null;
}

/** Whether a media row holds a video rather than an image. */
export function isVideo(media: Doc<"media">): boolean {
  return media.contentType.startsWith("video/");
}

/** The public URL of an image or video, or null when nothing should show it. */
export async function mediaUrl(ctx: QueryCtx, media: Doc<"media">): Promise<string | null> {
  if (media.orphanedAt !== undefined) return null;
  if (media.backend !== "b2") return await ctx.storage.getUrl(media.storageId);
  const base = mediaPublicBase();
  if (!base) {
    console.error(`MEDIA_PUBLIC_URL isn't set on this Convex deployment, so ${media.key} has no URL.`);
    return null;
  }
  return `${base}/${media.key}`;
}

/**
 * Lets go of images none of their owner's launches show any more, after a
 * slop is deleted, its screenshots change or a scheduled launch is
 * cancelled. Media is only ever attached to its owner's slops and scheduled
 * launches, so those are the only places to look.
 *
 * Convex-stored files go now, in this transaction. B2 objects can only be
 * deleted by the app server, which holds the bucket key, so they're marked
 * orphaned and wait for it (`orphans`, then `forget`). Returns how many wait.
 */
export async function releaseMedia(
  ctx: MutationCtx,
  ownerId: Id<"users">,
  ids: readonly Id<"media">[],
): Promise<number> {
  if (ids.length === 0) return 0;
  const shown = new Set<Id<"media">>();
  const launches = await ctx.db
    .query("slops")
    .withIndex("by_user", (q) => q.eq("userId", ownerId))
    .collect();
  const queued = await ctx.db
    .query("scheduledLaunches")
    .withIndex("by_user_release", (q) => q.eq("userId", ownerId))
    .collect();
  for (const launch of [...launches, ...queued]) for (const id of launch.screenshots) shown.add(id);
  for (const launch of launches) if (launch.video) shown.add(launch.video.mediaId);

  let waiting = 0;
  for (const id of new Set(ids)) {
    if (shown.has(id)) continue;
    const media = await ctx.db.get(id);
    if (!media || media.orphanedAt !== undefined) continue;
    if (media.backend === "b2") {
      await ctx.db.patch(id, { orphanedAt: Date.now() });
      waiting++;
    } else {
      await ctx.storage.delete(media.storageId);
      await ctx.db.delete(id);
    }
  }
  return waiting;
}
