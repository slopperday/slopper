import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convex } from "./convex";
import type { UpdateForm } from "./forms";
import { linkPreview, type StoredPreview } from "./preview";

export interface PostedUpdate {
  updateId: Id<"updates">;
  /** Links the maker wanted a card for whose page couldn't be read. They still show as plain links. */
  missedPreviews: number;
}

/**
 * Posts a validated update (`validateUpdate`). The composer, the REST API
 * and MCP all post through here. Cards are read only for the links the maker
 * asked for, all at once, after reserving the maker's daily attempt.
 */
export async function postUpdate(
  ownerId: Id<"users">,
  slopId: Id<"slops">,
  update: UpdateForm,
  preview: (ownerId: Id<"users">, url: string) => Promise<StoredPreview | null> = linkPreview,
): Promise<PostedUpdate> {
  const reservationId = await convex.mutation(api.activity.reserveUpdate, { userId: ownerId, slopId });
  const cards = await Promise.all(
    update.links.map(async (link) => (link.preview ? await preview(ownerId, link.url) : null)),
  );
  const updateId = await convex.mutation(api.activity.addUpdate, {
    reservationId,
    userId: ownerId,
    slopId,
    kind: update.kind,
    body: update.body,
    version: update.version,
    images: update.images,
    links: update.links.map((link, index) => ({ kind: link.kind, url: link.url, preview: cards[index] })),
    details: update.details,
  });
  const missedPreviews = update.links.filter((link, index) => link.preview && cards[index] === null).length;
  return { updateId, missedPreviews };
}

/** One line for a flash message, or "" when every card came through. */
export function missedPreviewsNote(missed: number): string {
  if (missed === 0) return "";
  return missed === 1 ? " One link had no preview to show." : ` ${missed} links had no preview to show.`;
}
