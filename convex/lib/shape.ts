import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type { LinkPreview, SlopLink, UpdateDetails, UpdateKind } from "../../app/lib/model";
import { renderMarkdown } from "../../app/lib/markdown";
import { mediaUrl } from "./media";

/**
 * What leaves Convex. Public queries return these shapes, never raw
 * documents: downvotes, auto-post wiring and private settings stay inside.
 */

export interface PublicUser {
  id: Id<"users">;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  website: string | null;
  createdAt: number;
}

export function publicUser(user: Doc<"users">): PublicUser {
  return {
    id: user._id,
    username: user.username,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    bio: user.bio,
    website: user.website,
    createdAt: user._creationTime,
  };
}

export interface PublicSlop {
  id: Id<"slops">;
  userId: Id<"users">;
  /** The product's first launch (itself for a first launch). */
  productId: Id<"slops">;
  launchLabel: string | null;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  category: string;
  nsfw: boolean;
  links: SlopLink[];
  /** Screenshot URLs, cover first. */
  screenshots: string[];
  /** The promo video's URL, once a moderator has approved it. */
  video: string | null;
  /** A video is waiting for a moderator (convex/videos.ts). */
  videoPending: boolean;
  madeWith: string[];
  launchDate: string;
  raceDate: string;
  launchedAt: number;
  goalDay: number | null;
  goalLength: number | null;
  number: number;
  upvotes: number;
  commentCount: number;
  updateCount: number;
  fieldTests: number;
  backers: number;
  pledged: number;
  lastActivityAt: number;
  slopOfTheDay: string | null;
  slopcessfulAt: number | null;
  slopcessfulNote: string | null;
  hidden: boolean;
}

export function productIdOf(slop: Doc<"slops">): Id<"slops"> {
  return slop.productId ?? slop._id;
}

export async function screenshotUrls(ctx: QueryCtx, ids: readonly Id<"media">[]): Promise<string[]> {
  const urls: string[] = [];
  for (const id of ids) {
    const media = await ctx.db.get(id);
    const url = media ? await mediaUrl(ctx, media) : null;
    if (url) urls.push(url);
  }
  return urls;
}

async function approvedVideoUrl(ctx: QueryCtx, id: Id<"media">): Promise<string | null> {
  const media = await ctx.db.get(id);
  return media ? await mediaUrl(ctx, media) : null;
}

export async function publicSlop(ctx: QueryCtx, slop: Doc<"slops">): Promise<PublicSlop> {
  return {
    id: slop._id,
    userId: slop.userId,
    productId: productIdOf(slop),
    launchLabel: slop.launchLabel,
    slug: slop.slug,
    name: slop.name,
    tagline: slop.tagline,
    description: slop.description,
    category: slop.category,
    nsfw: slop.nsfw,
    links: slop.links,
    screenshots: await screenshotUrls(ctx, slop.screenshots),
    video: slop.video?.approvedAt ? await approvedVideoUrl(ctx, slop.video.mediaId) : null,
    videoPending: slop.video !== undefined && slop.video.approvedAt === null,
    madeWith: slop.madeWith,
    launchDate: slop.launchDate,
    raceDate: slop.raceDate,
    launchedAt: slop._creationTime,
    goalDay: slop.goalDay,
    goalLength: slop.goalLength,
    number: slop.number,
    upvotes: slop.upvotes,
    commentCount: slop.commentCount,
    updateCount: slop.updateCount,
    fieldTests: slop.fieldTests,
    backers: slop.backers,
    pledged: slop.pledged,
    lastActivityAt: slop.lastActivityAt,
    slopOfTheDay: slop.slopOfTheDay,
    slopcessfulAt: slop.slopcessfulAt,
    slopcessfulNote: slop.slopcessfulNote,
    hidden: slop.hidden,
  };
}

export interface PublicUpdateLink extends SlopLink {
  preview: (LinkPreview & { image: string | null }) | null;
}

/** An update as the slop page shows it. Where it was auto-posted is added for the owner only. */
export interface PublicUpdate {
  id: Id<"updates">;
  kind: UpdateKind;
  html: string;
  createdAt: number;
  version: string | null;
  /** Image URLs, in order. */
  images: string[];
  links: PublicUpdateLink[];
  details: UpdateDetails | null;
}

async function imageUrl(ctx: QueryCtx, id: Id<"media"> | null): Promise<string | null> {
  const media = id ? await ctx.db.get(id) : null;
  return media ? await mediaUrl(ctx, media) : null;
}

export async function publicUpdate(ctx: QueryCtx, update: Doc<"updates">): Promise<PublicUpdate> {
  const links: PublicUpdateLink[] = [];
  for (const { kind, url, preview } of update.links ?? []) {
    links.push({
      kind,
      url,
      preview: preview
        ? {
            title: preview.title,
            description: preview.description,
            siteName: preview.siteName,
            image: await imageUrl(ctx, preview.imageId),
          }
        : null,
    });
  }
  return {
    id: update._id,
    kind: update.kind,
    html: renderMarkdown(update.body),
    createdAt: update._creationTime,
    version: update.version ?? null,
    images: await screenshotUrls(ctx, update.images ?? []),
    links,
    details: update.details ?? null,
  };
}

export type Vote = 1 | -1 | 0;
export type VoteMode = "vote" | "login" | "own";

/** A slop ready to render: who made it and how the reader voted. */
export interface CardItem {
  slop: PublicSlop;
  owner: PublicUser;
  vote: Vote;
  voteMode: VoteMode;
  /** Blur its screenshots: NSFW, and the reader neither made it nor opted in to seeing NSFW. */
  blur: boolean;
}

/** Hidden slops never show in feeds; NSFW ones only for people who opted in. */
export function isVisibleTo(slop: Doc<"slops">, reader: Doc<"users"> | null): boolean {
  if (reader?._id === slop.userId) return true;
  if (slop.hidden) return false;
  return !slop.nsfw || reader?.showNsfw === true;
}

export async function voteOf(ctx: QueryCtx, slopId: Id<"slops">, userId: Id<"users">): Promise<Vote> {
  const row = await ctx.db
    .query("votes")
    .withIndex("by_slop_user", (q) => q.eq("slopId", slopId).eq("userId", userId))
    .unique();
  return row?.value ?? 0;
}

export async function toCards(
  ctx: QueryCtx,
  slops: readonly Doc<"slops">[],
  reader: Doc<"users"> | null,
): Promise<CardItem[]> {
  const owners = new Map<Id<"users">, Doc<"users"> | null>();
  const cards: CardItem[] = [];
  for (const slop of slops) {
    if (!isVisibleTo(slop, reader)) continue;
    if (!owners.has(slop.userId)) owners.set(slop.userId, await ctx.db.get(slop.userId));
    const owner = owners.get(slop.userId);
    if (!owner) continue;
    cards.push({
      slop: await publicSlop(ctx, slop),
      owner: publicUser(owner),
      vote: reader ? await voteOf(ctx, slop._id, reader._id) : 0,
      voteMode: !reader ? "login" : reader._id === slop.userId ? "own" : "vote",
      blur: slop.nsfw && reader?._id !== slop.userId && reader?.showNsfw !== true,
    });
  }
  return cards;
}
