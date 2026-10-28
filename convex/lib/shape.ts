import type { Doc, Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
import type {
  LinkPreview,
  ReviewExperience,
  SlopFeature,
  SlopLink,
  UpdateDetails,
  UpdateKind,
} from "../../app/lib/model";
import { renderMarkdown } from "../../app/lib/markdown";
import type { DemoVideo } from "../../app/lib/video";
import { mediaUrl, type PublicationFormat, publicationFormat, publicationName } from "./media";

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
  /** The PDF the maker wrote, to read on its page. */
  publication: PublicPublication | null;
  madeWith: string[];
  /** A demo video linked on YouTube, Loom or Vimeo, shown beside the name. The uploaded promo is `video`. */
  demo: DemoVideo | null;
  features: SlopFeature[];
  /** Who it's for, in one line. Empty when the maker hasn't said. */
  audience: string;
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

export interface PublicPublication {
  url: string;
  fileName: string;
  format: PublicationFormat;
  /** Bytes. */
  size: number;
}

async function publicationOf(ctx: QueryCtx, id: Id<"media"> | undefined): Promise<PublicPublication | null> {
  const media = id ? await ctx.db.get(id) : null;
  const url = media ? await mediaUrl(ctx, media) : null;
  const format = media ? publicationFormat(media.contentType) : null;
  return media && url && format ? { url, fileName: publicationName(media), format, size: media.size } : null;
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
    publication: await publicationOf(ctx, slop.publication),
    madeWith: slop.madeWith,
    demo: slop.demo ?? null,
    features: slop.features ?? [],
    audience: slop.audience ?? "",
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
    hidden: isHidden(slop),
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

/** A review as the slop page shows it. What the content check said stays in Convex, but for `mature`. */
export interface PublicReview {
  id: Id<"reviews">;
  experience: ReviewExperience;
  html: string;
  createdAt: number;
  editedAt: number | null;
  /** Image URLs, in order. */
  images: string[];
  /** Blur it for readers who haven't opted in to NSFW. */
  mature: boolean;
  /** Null when the reviewer's account is gone. */
  author: PublicUser | null;
}

export async function publicReview(
  ctx: QueryCtx,
  review: Doc<"reviews">,
  author: PublicUser | null,
): Promise<PublicReview> {
  return {
    id: review._id,
    experience: review.experience,
    html: renderMarkdown(review.body),
    createdAt: review._creationTime,
    editedAt: review.editedAt,
    images: await screenshotUrls(ctx, review.images),
    mature: review.check.verdict === "mature",
    author,
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

/** Unchecked legacy rows are held too; new writes also set hidden atomically. */
export function isHidden(slop: Doc<"slops">): boolean {
  return slop.hidden || slop.publishAfterCheck !== undefined || !slop.check;
}

/** Hidden slops never show in feeds; NSFW ones only for people who opted in. */
export function isVisibleTo(slop: Doc<"slops">, reader: Doc<"users"> | null): boolean {
  if (reader?._id === slop.userId) return true;
  if (isHidden(slop)) return false;
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

/**
 * What the content check reads from a slop (app/.server/moderation.ts
 * `checkedContent`, mirrored here: Convex can't import app code). A check's
 * verdict is tied to this: `applyCheck` only lands when the slop still says
 * the same things, so a verdict computed before an edit can't clear the way
 * for the edited text (convex/moderation.ts).
 */
export function checkedContentOf(slop: {
  name: string;
  tagline: string;
  description: string;
  links: unknown;
  madeWith: readonly string[];
  screenshots: readonly unknown[];
  demo?: unknown;
  features?: readonly unknown[];
  audience?: string;
  publication?: unknown;
}): string {
  return JSON.stringify([
    slop.name,
    slop.tagline,
    slop.description,
    slop.links,
    slop.madeWith,
    slop.screenshots,
    slop.demo ?? null,
    slop.features ?? [],
    slop.audience ?? "",
    slop.publication ?? null,
  ]);
}

/** FNV-1a, 32 bits, as eight hex digits: short, stable, and quick. */
function fnv1a(text: string, seed: number): string {
  let hash = seed;
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * A fingerprint of the checked content: forwards and backwards, so two texts
 * that collide one way don't the other. Good enough to stop a verdict meant
 * for one text from clearing another.
 */
export function checkedContentHash(slop: Parameters<typeof checkedContentOf>[0]): string {
  const content = checkedContentOf(slop);
  return `${fnv1a(content, 0x811c9dc5)}${fnv1a(content, 0x7fffffff)}`;
}
