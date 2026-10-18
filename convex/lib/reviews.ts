import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import { mediaUrl } from "./media";
import { can } from "./permissions";
import { type PublicReview, publicReview, publicUser } from "./shape";

export interface SlopReviews {
  /** Newest first. */
  reviews: (PublicReview & { canDelete: boolean; blur: boolean })[];
  /** The reader's own review, to edit: its image ids with their URLs. */
  mine: {
    id: Id<"reviews">;
    experience: Doc<"reviews">["experience"];
    body: string;
    images: { id: string; url: string }[];
    editedAt: number | null;
  } | null;
}

/** A slop's reviews as `reader` sees them. The caller has already checked they may see the slop. */
export async function reviewsFor(
  ctx: QueryCtx,
  slopId: Id<"slops">,
  reader: Doc<"users"> | null,
): Promise<SlopReviews> {
  const rows = await ctx.db
    .query("reviews")
    .withIndex("by_slop_user", (q) => q.eq("slopId", slopId))
    .collect();
  rows.sort((a, b) => b._creationTime - a._creationTime);
  const reviews: SlopReviews["reviews"] = [];
  let mine: SlopReviews["mine"] = null;
  for (const row of rows) {
    const author = await ctx.db.get(row.userId);
    reviews.push({
      ...(await publicReview(ctx, row, author ? publicUser(author) : null)),
      canDelete: reader !== null && (reader._id === row.userId || can(reader, "reviews.deleteAny")),
      // Mature reviews are blurred, like NSFW slops, for everyone but their author and those who opted in.
      blur: row.check.verdict === "mature" && reader?._id !== row.userId && reader?.showNsfw !== true,
    });
    if (reader?._id === row.userId) {
      const images: { id: string; url: string }[] = [];
      for (const id of row.images) {
        const media = await ctx.db.get(id);
        const url = media ? await mediaUrl(ctx, media) : null;
        if (url) images.push({ id, url });
      }
      mine = { id: row._id, experience: row.experience, body: row.body, images, editedAt: row.editedAt };
    }
  }
  return { reviews, mine };
}
