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

/** Publications are PDFs or EPUBs, and nothing else. */
export const PUBLICATION_TYPES = { pdf: "application/pdf", epub: "application/epub+zip" } as const;

export type PublicationFormat = keyof typeof PUBLICATION_TYPES;

/** Which kind of publication a content type is, or null when it isn't one. */
export function publicationFormat(contentType: string): PublicationFormat | null {
  if (contentType === PUBLICATION_TYPES.pdf) return "pdf";
  if (contentType === PUBLICATION_TYPES.epub) return "epub";
  return null;
}

/** Whether a media row holds a publication: one PDF or EPUB a maker wrote. */
export function isPublication(media: Doc<"media">): boolean {
  return publicationFormat(media.contentType) !== null;
}

/** The name a publication is shown by. */
export function publicationName(media: Doc<"media">): string {
  return media.fileName ?? `publication.${publicationFormat(media.contentType) ?? "pdf"}`;
}

/** Whether a media row holds an image, the only thing a screenshot can be. */
export function isImage(media: Doc<"media">): boolean {
  return media.contentType.startsWith("image/");
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

/** Every image an update shows: its own, then its link cards'. */
export function updateMedia(update: Doc<"updates">): Id<"media">[] {
  const previews = (update.links ?? []).flatMap((link) => (link.preview?.imageId ? [link.preview.imageId] : []));
  return [...(update.images ?? []), ...previews];
}

/**
 * Lets go of images (and publications) none of their owner's launches,
 * updates or reviews show any more, after a slop, update or review is
 * deleted, its screenshots or publication change, a link card is removed or a scheduled launch is cancelled. Media is
 * only ever attached to its owner's slops, updates, reviews and scheduled
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
  // Released entries are retry records; their live slop owns the media now.
  for (const launch of [...launches, ...queued.filter((entry) => !entry.released)]) {
    for (const id of launch.screenshots) shown.add(id);
    if (launch.publication) shown.add(launch.publication);
  }
  for (const launch of launches) if (launch.video) shown.add(launch.video.mediaId);
  const updates = await ctx.db
    .query("updates")
    .withIndex("by_user", (q) => q.eq("userId", ownerId))
    .collect();
  for (const update of updates) for (const id of updateMedia(update)) shown.add(id);
  const reviews = await ctx.db
    .query("reviews")
    .withIndex("by_user", (q) => q.eq("userId", ownerId))
    .collect();
  for (const review of reviews) for (const id of review.images) shown.add(id);

  let waiting = 0;
  for (const id of new Set(ids)) {
    const media = await ctx.db.get(id);
    if (!media || media.orphanedAt !== undefined) continue;
    if (shown.has(id)) {
      // Still shown somewhere, so it stays — and counts as attached, which
      // keeps the never-attached sweep from looking at it again.
      if (media.attached !== true) await ctx.db.patch(id, { attached: true });
      continue;
    }
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
