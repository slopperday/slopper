import { ConvexError, type Infer, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  type MutationCtx,
  mutation,
  query,
  type QueryCtx,
} from "./_generated/server";
import { requireServer } from "./lib/auth";
import { isImage, isPublication, isVideo, mediaUrl } from "./lib/media";
import { consume } from "./lib/rate";
import { canAccessAccount, userOrganizationIds } from "./organizations";
import { networkOptionsValidator, socialMetricsValidator } from "./schema";
import { NETWORKS } from "../app/lib/networks";
import { hasSpintax } from "../app/lib/variables";

/**
 * Studio posts: written once, sent to many accounts (app/routes/studio.tsx).
 * Convex keeps the post, one delivery per account, and their stats; the app
 * server holds the account credentials, so it does the sending
 * (app/.server/social/studio.ts) and Convex only says when.
 */

/** How long one app caller has a delivery before the backstop takes it back. */
const LEASE_MS = 5 * 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RETRIES = 3;
/** Posts a person can send an hour: each is a call to every network they picked. */
const POSTS_PER_HOUR = 30;
/** Entries kept in a post's activity log. */
const ACTIVITY = 50;

function appBase(): string {
  return (process.env.APP_URL ?? "https://slopper.day").replace(/\/+$/, "");
}

/**
 * When to read a sent post's stats again: hourly on its first day, then
 * every few hours for a week, daily to a month, then never. X bills every
 * read, so its posts are read at most daily.
 */
export function nextMetricsAt(provider: Doc<"socialDeliveries">["provider"], sentAt: number, now: number) {
  const age = now - sentAt;
  if (age > 30 * DAY) return undefined;
  const gap = age < DAY ? HOUR : age < 7 * DAY ? 6 * HOUR : DAY;
  return now + (provider === "x" ? Math.max(gap, DAY) : gap);
}

async function ownedPost(ctx: QueryCtx, userId: Id<"users">, rawId: string) {
  const id = ctx.db.normalizeId("socialPosts", rawId);
  const post = id ? await ctx.db.get(id) : null;
  if (!post) return null;
  if (post.userId === userId) return post;
  if (post.organizationId && (await userOrganizationIds(ctx, userId)).has(post.organizationId)) return post;
  return null;
}

async function deliveriesOf(ctx: QueryCtx, postId: Id<"socialPosts">) {
  return await ctx.db
    .query("socialDeliveries")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .collect();
}

async function mediaFor(ctx: QueryCtx, post: Doc<"socialPosts">) {
  return await Promise.all(
    post.media.map(async (item) => {
      const media = await ctx.db.get(item.mediaId);
      return {
        ...item,
        url: media ? await mediaUrl(ctx, media) : null,
        contentType: media?.contentType ?? "application/octet-stream",
        size: media?.size ?? 0,
      };
    }),
  );
}

async function log(ctx: MutationCtx, post: Doc<"socialPosts">, kind: string, detail: string) {
  const activity = [...(post.activity ?? []), { at: Date.now(), kind, detail }].slice(-ACTIVITY);
  await ctx.db.patch(post._id, { activity });
  post.activity = activity;
}

async function settingsOf(ctx: QueryCtx, userId: Id<"users">) {
  return await ctx.db
    .query("socialSettings")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}

/** A post as its owner sees it: never credentials, never another person's. */
async function shapePost(ctx: QueryCtx, post: Doc<"socialPosts">) {
  const deliveries = await deliveriesOf(ctx, post._id);
  const product = post.productId ? await ctx.db.get(post.productId) : null;
  const cover = post.coverMediaId ? await ctx.db.get(post.coverMediaId) : null;
  const links = await ctx.db
    .query("socialLinks")
    .withIndex("by_post", (q) => q.eq("postId", post._id))
    .collect();
  return {
    id: post._id,
    createdAt: post._creationTime,
    text: post.text,
    link: post.link,
    overrides: post.overrides,
    options: post.options,
    scheduledAt: post.scheduledAt,
    cancelled: post.cancelled ?? false,
    draft: post.draft ?? false,
    released: post.released ?? false,
    thread: post.thread ?? [],
    firstComment: post.firstComment ?? "",
    note: post.note ?? "",
    tags: post.tags ?? [],
    repeat: post.repeat ?? null,
    staggerMinutes: post.staggerMinutes ?? 0,
    plug: post.plug ?? null,
    trackLinks: post.trackLinks ?? false,
    source: post.source ?? "web",
    activity: post.activity ?? [],
    cover: cover ? { id: cover._id, url: await mediaUrl(ctx, cover) } : null,
    product: product ? { id: product._id, name: product.name } : null,
    media: (await mediaFor(ctx, post)).map(({ mediaId, kind, url, duration, alt, coverAt, width, height }) => ({
      id: mediaId,
      kind,
      url,
      duration: duration ?? null,
      alt: alt ?? "",
      coverAt: coverAt ?? null,
      width: width ?? null,
      height: height ?? null,
    })),
    links: links.map((row) => ({ provider: row.provider, code: row.code, clicks: row.clicks })),
    deliveries: deliveries.map((row) => ({
      id: row._id,
      accountId: row.accountId,
      provider: row.provider,
      handle: row.handle,
      status: row.status,
      repost: row.repost ?? false,
      url: row.url ?? null,
      message: row.message ?? null,
      warning: row.warning ?? null,
      uncertain: row.uncertain ?? false,
      sentAt: row.sentAt ?? null,
      notBefore: row.notBefore ?? null,
      metrics: row.metrics ?? null,
      metricsAt: row.metricsAt ?? null,
      parts: row.parts?.length ?? 0,
    })),
  };
}

export type StudioPost = Awaited<ReturnType<typeof shapePost>>;

const mediaInput = v.object({
  mediaId: v.string(),
  duration: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
  alt: v.optional(v.string()),
  coverAt: v.optional(v.number()),
});

const postFields = {
  productId: v.union(v.string(), v.null()),
  text: v.string(),
  link: v.union(v.string(), v.null()),
  media: v.array(mediaInput),
  overrides: v.record(v.string(), v.string()),
  options: networkOptionsValidator,
  accountIds: v.array(v.string()),
  scheduledAt: v.union(v.number(), v.null()),
  repostAccountIds: v.optional(v.array(v.string())),
  thread: v.optional(v.array(v.string())),
  firstComment: v.optional(v.string()),
  note: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  draft: v.optional(v.boolean()),
  repeat: v.optional(v.object({ everyDays: v.number(), remaining: v.number() })),
  staggerMinutes: v.optional(v.number()),
  plug: v.optional(v.object({ likes: v.number(), text: v.string() })),
  trackLinks: v.optional(v.boolean()),
  coverMediaId: v.optional(v.string()),
};

type PostInput = Infer<ReturnType<typeof v.object<typeof postFields>>> & { userId: Id<"users"> };

async function ownedAccounts(ctx: MutationCtx, userId: Id<"users">, ids: readonly string[]) {
  const accounts: Doc<"accounts">[] = [];
  for (const raw of new Set(ids)) {
    const id = ctx.db.normalizeId("accounts", raw);
    const account = id ? await ctx.db.get(id) : null;
    if (!account || !(await canAccessAccount(ctx, userId, account))) {
      throw new ConvexError("One of those accounts isn't yours.");
    }
    accounts.push(account);
  }
  return accounts;
}

/** Checks what a post is made of, and turns the input into what's stored (without deliveries). */
async function preparePost(ctx: MutationCtx, args: PostInput) {
  const accounts = await ownedAccounts(ctx, args.userId, args.accountIds);
  if (accounts.length === 0) throw new ConvexError("Pick at least one account to post as.");
  const reposters = (await ownedAccounts(ctx, args.userId, args.repostAccountIds ?? [])).filter(
    (account) => !accounts.some((other) => other._id === account._id),
  );
  for (const account of reposters) {
    if (!NETWORKS[account.provider].canRepost) {
      throw new ConvexError(`${NETWORKS[account.provider].label} can't repost through apps.`);
    }
    if (!accounts.some((other) => other.provider === account.provider)) {
      throw new ConvexError(
        `Nothing for ${account.handle} to repost: no account posts on ${NETWORKS[account.provider].label}.`,
      );
    }
  }

  const media: Doc<"socialPosts">["media"] = [];
  for (const item of args.media) {
    const id = ctx.db.normalizeId("media", item.mediaId);
    const row = id ? await ctx.db.get(id) : null;
    if (!row || row.ownerId !== args.userId || row.orphanedAt !== undefined) {
      throw new ConvexError("That upload is gone. Add it again.");
    }
    const kind = isVideo(row)
      ? "video"
      : isImage(row)
        ? "image"
        : isPublication(row) && row.contentType === "application/pdf"
          ? "document"
          : null;
    if (!kind) throw new ConvexError("Posts take pictures, videos and PDFs.");
    media.push({
      mediaId: row._id,
      kind,
      duration: item.duration,
      width: item.width,
      height: item.height,
      alt: item.alt?.trim().slice(0, 1000) || undefined,
      coverAt: item.coverAt,
    });
  }
  let coverMediaId: Id<"media"> | undefined;
  if (args.coverMediaId) {
    const id = ctx.db.normalizeId("media", args.coverMediaId);
    const row = id ? await ctx.db.get(id) : null;
    if (!row || row.ownerId !== args.userId || !isImage(row)) throw new ConvexError("That thumbnail is gone.");
    coverMediaId = row._id;
  }

  let productId: Id<"slops"> | null = null;
  if (args.productId) {
    const id = ctx.db.normalizeId("slops", args.productId);
    const slop = id ? await ctx.db.get(id) : null;
    if (!slop || slop.userId !== args.userId) throw new ConvexError("That product isn't yours.");
    productId = slop.productId ?? slop._id;
  }

  // Networks refuse the same words twice, and so do followers: spintax makes each copy differ.
  if (!args.draft && !hasSpintax(args.text)) {
    for (const account of accounts) {
      const words = args.overrides[account._id]?.trim() || args.overrides[account.provider]?.trim() || args.text.trim();
      if (!words || hasSpintax(words)) continue;
      const recent = await ctx.db
        .query("socialDeliveries")
        .withIndex("by_account", (q) => q.eq("accountId", account._id))
        .order("desc")
        .take(20);
      for (const row of recent) {
        if (row.status !== "ok" || (row.sentAt ?? 0) < Date.now() - DAY) continue;
        const sent = await ctx.db.get(row.postId);
        const sentWords =
          sent?.overrides[account._id]?.trim() || sent?.overrides[account.provider]?.trim() || sent?.text.trim() || "";
        if (sentWords === words) {
          throw new ConvexError(
            `You posted these exact words as ${account.handle} in the last day. Change them a little, or use {spintax|variations}.`,
          );
        }
      }
    }
  }

  const organizationId = [...accounts, ...reposters].find((account) => account.organizationId)?.organizationId;
  const fields = {
    ...(organizationId ? { organizationId } : {}),
    productId,
    text: args.text,
    link: args.link,
    media,
    overrides: args.overrides,
    options: args.options,
    scheduledAt: args.scheduledAt,
    draft: args.draft || undefined,
    thread: args.thread?.length ? args.thread.slice(0, 25) : undefined,
    firstComment: args.firstComment?.trim() || undefined,
    note: args.note?.trim() || undefined,
    tags: args.tags?.length
      ? [...new Set(args.tags.map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 10)
      : undefined,
    repeat:
      args.repeat && args.repeat.everyDays >= 1 && args.repeat.remaining >= 1
        ? {
            everyDays: Math.min(Math.round(args.repeat.everyDays), 365),
            remaining: Math.min(Math.round(args.repeat.remaining), 52),
          }
        : undefined,
    staggerMinutes:
      args.staggerMinutes && args.staggerMinutes > 0 ? Math.min(Math.round(args.staggerMinutes), 720) : undefined,
    plug:
      args.plug && args.plug.likes > 0 && args.plug.text.trim()
        ? { likes: Math.round(args.plug.likes), text: args.plug.text.trim() }
        : undefined,
    trackLinks: (args.trackLinks && args.link !== null) || undefined,
    coverMediaId,
  };
  return { fields, accounts, reposters };
}

function randomCode(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

/** The link with UTM tags saying which network and which campaign a click came from. */
export function utmLink(link: string, provider: string, campaign: string): string {
  try {
    const url = new URL(link);
    if (!url.searchParams.has("utm_source")) url.searchParams.set("utm_source", provider);
    if (!url.searchParams.has("utm_medium")) url.searchParams.set("utm_medium", "social");
    if (!url.searchParams.has("utm_campaign")) url.searchParams.set("utm_campaign", campaign);
    return url.href;
  } catch {
    return link;
  }
}

/** Makes the deliveries (and tracked links) for a stored post, and asks to be told when each is due. */
async function makeDeliveries(
  ctx: MutationCtx,
  post: Doc<"socialPosts">,
  accounts: readonly Doc<"accounts">[],
  reposters: readonly Doc<"accounts">[],
) {
  const base = post.scheduledAt ?? Date.now();
  const stagger = (post.staggerMinutes ?? 0) * 60_000;
  const due = new Set<number>();
  for (const [index, account] of accounts.entries()) {
    const notBefore = stagger ? base + index * stagger : undefined;
    if (notBefore !== undefined && notBefore > base) due.add(notBefore);
    await ctx.db.insert("socialDeliveries", {
      postId: post._id,
      userId: post.userId,
      accountId: account._id,
      provider: account.provider,
      handle: account.handle,
      status: "queued",
      attempts: 0,
      ...(notBefore !== undefined ? { notBefore } : {}),
    });
  }
  for (const account of reposters) {
    await ctx.db.insert("socialDeliveries", {
      postId: post._id,
      userId: post.userId,
      accountId: account._id,
      provider: account.provider,
      handle: account.handle,
      status: "queued",
      attempts: 0,
      repost: true,
    });
  }
  // Drafts aren't checked yet: no Slopper short link points anywhere until the post is.
  if (post.trackLinks && post.link && !post.draft) {
    const campaign = post.tags?.[0] ?? "slopper-studio";
    for (const provider of new Set(accounts.map((account) => account.provider))) {
      await ctx.db.insert("socialLinks", {
        code: randomCode(),
        userId: post.userId,
        postId: post._id,
        provider,
        url: utmLink(post.link, provider, campaign),
        clicks: 0,
      });
    }
  }
  if (post.draft) return;
  if (post.scheduledAt !== null) {
    await ctx.scheduler.runAt(post.scheduledAt, internal.social.tellApp, { postId: post._id, attempt: 1 });
  }
  for (const at of due) await ctx.scheduler.runAt(at, internal.social.tellApp, { postId: post._id, attempt: 1 });
}

async function clearDeliveries(ctx: MutationCtx, postId: Id<"socialPosts">) {
  for (const row of await deliveriesOf(ctx, postId)) await ctx.db.delete(row._id);
  const links = await ctx.db
    .query("socialLinks")
    .withIndex("by_post", (q) => q.eq("postId", postId))
    .collect();
  for (const row of links) await ctx.db.delete(row._id);
}

async function attach(ctx: MutationCtx, fields: { media: Doc<"socialPosts">["media"]; coverMediaId?: Id<"media"> }) {
  for (const item of fields.media) await ctx.db.patch(item.mediaId, { attached: true });
  if (fields.coverMediaId) await ctx.db.patch(fields.coverMediaId, { attached: true });
}

function describeTime(post: Pick<Doc<"socialPosts">, "draft" | "scheduledAt">): string {
  if (post.draft) return "Saved as a draft";
  return post.scheduledAt === null ? "Sent" : `Scheduled for ${new Date(post.scheduledAt).toISOString()}`;
}

export const create = mutation({
  args: {
    userId: v.id("users"),
    ...postFields,
    idempotencyKey: v.optional(v.string()),
    source: v.optional(v.union(v.literal("web"), v.literal("api"), v.literal("rss"), v.literal("csv"))),
  },
  handler: async (ctx, args): Promise<Id<"socialPosts">> => {
    await requireServer(ctx);
    if (args.idempotencyKey) {
      const existing = await ctx.db
        .query("socialPosts")
        .withIndex("by_user_key", (q) => q.eq("userId", args.userId).eq("idempotencyKey", args.idempotencyKey))
        .first();
      if (existing) return existing._id;
    }
    if (!args.draft) await consume(ctx, `social-post:${args.userId}`, POSTS_PER_HOUR, HOUR);
    const { fields, accounts, reposters } = await preparePost(ctx, args);
    const postId = await ctx.db.insert("socialPosts", {
      userId: args.userId,
      ...fields,
      ...(args.idempotencyKey ? { idempotencyKey: args.idempotencyKey.slice(0, 200) } : {}),
      source: args.source ?? "web",
    });
    await attach(ctx, fields);
    const post = (await ctx.db.get(postId))!;
    await log(ctx, post, "created", `${describeTime(post)}, for ${accounts.length + reposters.length} accounts`);
    await makeDeliveries(ctx, post, accounts, reposters);
    return postId;
  },
});

/** Whether a post can still be changed: a draft, or scheduled and not yet gone out. */
async function editable(ctx: QueryCtx, post: Doc<"socialPosts">): Promise<boolean> {
  if (post.cancelled || post.released) return false;
  if (!post.draft && (post.scheduledAt === null || post.scheduledAt <= Date.now())) return false;
  const rows = await deliveriesOf(ctx, post._id);
  return rows.every((row) => row.status === "queued");
}

/** Rewrites a draft or a scheduled post, accounts and all. Saving a draft without `draft` posts or schedules it. */
export const update = mutation({
  args: { userId: v.id("users"), postId: v.string(), ...postFields },
  handler: async (ctx, { postId, ...args }): Promise<Id<"socialPosts">> => {
    await requireServer(ctx);
    const post = await ownedPost(ctx, args.userId, postId);
    if (!post) throw new ConvexError("That post is gone.");
    if (!(await editable(ctx, post))) throw new ConvexError("It's already gone out, so it can't be changed.");
    if (!args.draft) await consume(ctx, `social-post:${args.userId}`, POSTS_PER_HOUR, HOUR);
    const { fields, accounts, reposters } = await preparePost(ctx, args);
    await clearDeliveries(ctx, post._id);
    await ctx.db.replace(post._id, {
      userId: post.userId,
      ...fields,
      ...(post.idempotencyKey ? { idempotencyKey: post.idempotencyKey } : {}),
      source: post.source,
      activity: post.activity,
    });
    await attach(ctx, fields);
    const next = (await ctx.db.get(post._id))!;
    await log(ctx, next, "edited", describeTime(next));
    await makeDeliveries(ctx, next, accounts, reposters);
    return post._id;
  },
});

/** Moves a scheduled post to another time (the calendar's drag and drop). */
export const reschedule = mutation({
  args: { userId: v.id("users"), postId: v.string(), scheduledAt: v.number() },
  handler: async (ctx, { userId, postId, scheduledAt }) => {
    await requireServer(ctx);
    const post = await ownedPost(ctx, userId, postId);
    if (!post || post.draft || !(await editable(ctx, post))) {
      throw new ConvexError("Only scheduled posts that haven't gone out can move.");
    }
    if (scheduledAt < Date.now() + 60_000) throw new ConvexError("Pick a time in the future.");
    const shift = scheduledAt - (post.scheduledAt ?? scheduledAt);
    await ctx.db.patch(post._id, { scheduledAt });
    for (const row of await deliveriesOf(ctx, post._id)) {
      if (row.notBefore !== undefined) {
        await ctx.db.patch(row._id, { notBefore: row.notBefore + shift });
        await ctx.scheduler.runAt(row.notBefore + shift, internal.social.tellApp, { postId: post._id, attempt: 1 });
      }
    }
    await ctx.scheduler.runAt(scheduledAt, internal.social.tellApp, { postId: post._id, attempt: 1 });
    await log(ctx, post, "rescheduled", new Date(scheduledAt).toISOString());
  },
});

/** Deletes a draft. Sent posts stay: they're the history the stats hang on. */
export const discard = mutation({
  args: { userId: v.id("users"), postId: v.string() },
  handler: async (ctx, { userId, postId }) => {
    await requireServer(ctx);
    const post = await ownedPost(ctx, userId, postId);
    if (!post?.draft) return false;
    await clearDeliveries(ctx, post._id);
    await ctx.db.delete(post._id);
    return true;
  },
});

/** A post that comes back: a copy for the next time, with its deliveries. */
async function repeatPost(ctx: MutationCtx, post: Doc<"socialPosts">) {
  if (!post.repeat || post.scheduledAt === null) return;
  const rows = await deliveriesOf(ctx, post._id);
  const loadedAccounts = await Promise.all(rows.filter((row) => !row.repost).map((row) => ctx.db.get(row.accountId)));
  const accounts: Doc<"accounts">[] = [];
  for (const account of loadedAccounts) {
    if (account && (await canAccessAccount(ctx, post.userId, account))) accounts.push(account);
  }
  const loadedReposters = await Promise.all(rows.filter((row) => row.repost).map((row) => ctx.db.get(row.accountId)));
  const reposters: Doc<"accounts">[] = [];
  for (const account of loadedReposters) {
    if (account && (await canAccessAccount(ctx, post.userId, account))) reposters.push(account);
  }
  if (accounts.length === 0) return;
  const { _id, _creationTime, released: _released, activity: _activity, idempotencyKey: _key, ...rest } = post;
  const remaining = post.repeat.remaining - 1;
  const nextId = await ctx.db.insert("socialPosts", {
    ...rest,
    scheduledAt: post.scheduledAt + post.repeat.everyDays * DAY,
    repeat: remaining > 0 ? { everyDays: post.repeat.everyDays, remaining } : undefined,
    activity: [
      { at: Date.now(), kind: "created", detail: `Repeat of an earlier post, every ${post.repeat.everyDays} days` },
    ],
  });
  await makeDeliveries(ctx, (await ctx.db.get(nextId))!, accounts, reposters);
}

/**
 * Hands the deliveries that are due to one app caller: queued ones once
 * their time has come (the post's, or the account's staggered turn), reposts
 * once there's something to repost, and processing uploads due another look.
 * Each is leased, so two callers never send the same copy. Nothing goes while
 * the person has paused the studio.
 */
export const claim = mutation({
  args: { postId: v.string(), userId: v.optional(v.id("users")) },
  handler: async (ctx, { postId: rawId, userId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("socialPosts", rawId);
    const post = id ? await ctx.db.get(id) : null;
    if (!post || post.cancelled || post.draft) return null;
    if (
      userId &&
      post.userId !== userId &&
      (!post.organizationId || !(await userOrganizationIds(ctx, userId)).has(post.organizationId))
    ) {
      return null;
    }
    const now = Date.now();
    if (post.scheduledAt !== null && post.scheduledAt > now) return null;
    if ((await settingsOf(ctx, post.userId))?.paused) return null;
    if (!post.released) {
      await ctx.db.patch(post._id, { released: true });
      await repeatPost(ctx, post);
    }

    const rows = await deliveriesOf(ctx, post._id);
    const claimed: Doc<"socialDeliveries">[] = [];
    for (const row of rows) {
      if ((row.leaseUntil ?? 0) > now || (row.notBefore ?? 0) > now) continue;
      const due = row.status === "queued" || (row.status === "processing" && (row.nextAttemptAt ?? 0) <= now);
      if (!due) continue;
      if (row.repost) {
        const originals = rows.filter((other) => !other.repost && other.provider === row.provider);
        if (!originals.some((other) => other.status === "ok")) {
          if (originals.every((other) => ["error", "skipped", "removed"].includes(other.status))) {
            await ctx.db.patch(row._id, { status: "skipped", message: "Nothing went out on this network to repost." });
          }
          continue;
        }
      }
      const account = await ctx.db.get(row.accountId);
      if (!account || !(await canAccessAccount(ctx, post.userId, account))) {
        await ctx.db.patch(row._id, { status: "skipped", message: "That account was disconnected." });
        continue;
      }
      const next = { status: row.status === "queued" ? ("sending" as const) : row.status, leaseUntil: now + LEASE_MS };
      await ctx.db.patch(row._id, next);
      claimed.push({ ...row, ...next });
    }
    if (claimed.length === 0) return null;
    const cover = post.coverMediaId ? await ctx.db.get(post.coverMediaId) : null;
    return {
      post,
      deliveries: claimed,
      media: await mediaFor(ctx, post),
      coverUrl: cover ? await mediaUrl(ctx, cover) : null,
      originals: rows
        .filter((row) => !row.repost && row.status === "ok" && row.remoteId)
        .map((row) => ({ provider: row.provider, remoteId: row.remoteId!, cid: row.cid, url: row.url ?? "" })),
      links: (
        await ctx.db
          .query("socialLinks")
          .withIndex("by_post", (q) => q.eq("postId", post._id))
          .collect()
      ).map((row) => ({ provider: row.provider, code: row.code })),
    } satisfies ClaimedPost;
  },
});

const resultValidator = v.union(
  v.object({ status: v.literal("ok"), remoteId: v.string(), url: v.string(), cid: v.optional(v.string()) }),
  v.object({ status: v.literal("processing"), pending: v.string(), retryAfterMs: v.number() }),
  v.object({ status: v.literal("error"), message: v.string(), uncertain: v.boolean() }),
  v.object({ status: v.literal("skipped"), message: v.string() }),
);

/** Records how one delivery went, and asks again later about an upload still processing. */
export const record = mutation({
  args: { deliveryId: v.id("socialDeliveries"), result: resultValidator },
  handler: async (ctx, { deliveryId, result }) => {
    await requireServer(ctx);
    const row = await ctx.db.get(deliveryId);
    if (!row) return;
    const post = await ctx.db.get(row.postId);
    const now = Date.now();
    const base = { leaseUntil: undefined, attempts: row.attempts + 1 };
    switch (result.status) {
      case "ok":
        await ctx.db.patch(row._id, {
          ...base,
          status: "ok",
          remoteId: result.remoteId,
          url: result.url,
          ...(result.cid ? { cid: result.cid } : {}),
          message: undefined,
          uncertain: undefined,
          pending: undefined,
          nextAttemptAt: undefined,
          sentAt: now,
          // A first read once people have had a moment to see it.
          nextMetricsAt: now + 15 * 60_000,
        });
        if (post)
          await log(
            ctx,
            post,
            "sent",
            `${row.repost ? "Reposted" : "Posted"} as ${row.handle} on ${NETWORKS[row.provider].label}`,
          );
        // Reposts on this network can go now.
        if (!row.repost && post) {
          const waiting = (await deliveriesOf(ctx, post._id)).some(
            (other) => other.repost && other.provider === row.provider && other.status === "queued",
          );
          if (waiting) await ctx.scheduler.runAfter(0, internal.social.tellApp, { postId: post._id, attempt: 1 });
        }
        return;
      case "processing": {
        const wait = Math.min(Math.max(result.retryAfterMs, 5_000), 10 * 60_000);
        await ctx.db.patch(row._id, {
          ...base,
          status: "processing",
          pending: result.pending,
          nextAttemptAt: now + wait,
          message: undefined,
        });
        await ctx.scheduler.runAfter(wait, internal.social.tellApp, { postId: row.postId, attempt: 1 });
        return;
      }
      case "error":
        await ctx.db.patch(row._id, {
          ...base,
          status: "error",
          message: result.message,
          uncertain: result.uncertain || undefined,
          pending: undefined,
          nextAttemptAt: undefined,
        });
        if (post) await log(ctx, post, "failed", `${row.handle} on ${NETWORKS[row.provider].label}: ${result.message}`);
        return;
      case "skipped":
        await ctx.db.patch(row._id, { ...base, status: "skipped", message: result.message });
        return;
    }
  },
});

/** What went out after the post itself: the thread's later posts and the first comment. */
export const recordParts = mutation({
  args: { deliveryId: v.id("socialDeliveries"), parts: v.array(v.string()), warning: v.union(v.string(), v.null()) },
  handler: async (ctx, { deliveryId, parts, warning }) => {
    await requireServer(ctx);
    const row = await ctx.db.get(deliveryId);
    if (!row) return;
    await ctx.db.patch(row._id, { parts, warning: warning ?? undefined });
  },
});

/** Queues a post's failed copies again. Sent ones stay sent, so a retry never posts twice. */
export const retry = mutation({
  args: { userId: v.id("users"), postId: v.string() },
  handler: async (ctx, { userId, postId }) => {
    await requireServer(ctx);
    const post = await ownedPost(ctx, userId, postId);
    if (!post || post.cancelled) return 0;
    await consume(ctx, `social-retry:${userId}`, POSTS_PER_HOUR, HOUR);
    let queued = 0;
    for (const row of await deliveriesOf(ctx, post._id)) {
      if (row.status !== "error") continue;
      await ctx.db.patch(row._id, { status: "queued", message: undefined, uncertain: undefined, notBefore: undefined });
      queued++;
    }
    if (queued) await log(ctx, post, "retried", `${queued} failed ${queued === 1 ? "copy" : "copies"} queued again`);
    return queued;
  },
});

/** Calls off a scheduled post before it goes out. */
export const cancel = mutation({
  args: { userId: v.id("users"), postId: v.string() },
  handler: async (ctx, { userId, postId }) => {
    await requireServer(ctx);
    const post = await ownedPost(ctx, userId, postId);
    if (!post || post.scheduledAt === null || post.scheduledAt <= Date.now() || post.released) return false;
    await ctx.db.patch(post._id, { cancelled: true });
    for (const row of await deliveriesOf(ctx, post._id)) {
      if (row.status === "queued") await ctx.db.patch(row._id, { status: "skipped", message: "Cancelled." });
    }
    await log(ctx, post, "cancelled", "Nothing went out");
    return true;
  },
});

/** A sent copy the owner took down from its network. */
export const markRemoved = mutation({
  args: { userId: v.id("users"), deliveryId: v.string() },
  handler: async (ctx, { userId, deliveryId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("socialDeliveries", deliveryId);
    const row = id ? await ctx.db.get(id) : null;
    if (!row || row.status !== "ok") return;
    const post = await ownedPost(ctx, userId, row.postId);
    if (!post) return;
    await ctx.db.patch(row._id, { status: "removed", nextMetricsAt: undefined });
    await log(ctx, post, "removed", `Taken down from ${NETWORKS[row.provider].label} (${row.handle})`);
  },
});

/** One sent copy, for its owner's server-side actions (take down, reply). */
export const ownedDelivery = query({
  args: { userId: v.id("users"), deliveryId: v.string() },
  handler: async (ctx, { userId, deliveryId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("socialDeliveries", deliveryId);
    const row = id ? await ctx.db.get(id) : null;
    if (!row) return null;
    if (row.userId === userId) return row;
    const post = await ownedPost(ctx, userId, row.postId);
    return post ? row : null;
  },
});

export const logActivity = mutation({
  args: { userId: v.id("users"), postId: v.string(), kind: v.string(), detail: v.string() },
  handler: async (ctx, { userId, postId, kind, detail }) => {
    await requireServer(ctx);
    const post = await ownedPost(ctx, userId, postId);
    if (post) await log(ctx, post, kind, detail.slice(0, 300));
  },
});

export const list = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, { userId, limit }) => {
    await requireServer(ctx);
    const cap = Math.min(limit ?? 20, 200);
    const mine = await ctx.db
      .query("socialPosts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(cap);
    const orgIds = await userOrganizationIds(ctx, userId);
    const seen = new Set(mine.map((post) => post._id));
    const shared: Doc<"socialPosts">[] = [];
    for (const orgId of orgIds) {
      const rows = await ctx.db
        .query("socialPosts")
        .withIndex("by_org", (q) => q.eq("organizationId", orgId))
        .order("desc")
        .take(cap);
      for (const row of rows) {
        if (!seen.has(row._id)) {
          seen.add(row._id);
          shared.push(row);
        }
      }
    }
    const posts = [...mine, ...shared].sort((a, b) => b._creationTime - a._creationTime).slice(0, cap);
    return await Promise.all(posts.map((post) => shapePost(ctx, post)));
  },
});

export const get = query({
  args: { userId: v.id("users"), postId: v.string() },
  handler: async (ctx, { userId, postId }) => {
    await requireServer(ctx);
    const post = await ownedPost(ctx, userId, postId);
    if (!post) return null;
    return { ...(await shapePost(ctx, post)), editable: await editable(ctx, post) };
  },
});

/** Times already taken by scheduled posts, so the queue picks free slots. */
export const scheduledTimes = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const posts = await ctx.db
      .query("socialPosts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(300);
    return posts
      .filter((post) => post.scheduledAt !== null && post.scheduledAt > Date.now() && !post.cancelled && !post.draft)
      .map((post) => post.scheduledAt!);
  },
});

/**
 * Everything the studio's analytics page adds up: each sent copy in the
 * period with its latest stats and the post's shape. Bounded, newest first.
 */
export const sent = query({
  args: { userId: v.id("users"), since: v.number() },
  handler: async (ctx, { userId, since }) => {
    await requireServer(ctx);
    const rows = await ctx.db
      .query("socialDeliveries")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(2000);
    const posts = new Map<Id<"socialPosts">, Doc<"socialPosts"> | null>();
    const out = [];
    for (const row of rows) {
      if (row.status !== "ok" || (row.sentAt ?? 0) < since) continue;
      if (!posts.has(row.postId)) posts.set(row.postId, await ctx.db.get(row.postId));
      const post = posts.get(row.postId);
      out.push({
        id: row._id,
        postId: row.postId,
        accountId: row.accountId,
        provider: row.provider,
        handle: row.handle,
        url: row.url ?? null,
        sentAt: row.sentAt!,
        metrics: row.metrics ?? null,
        repost: row.repost ?? false,
        text: post?.overrides[row.accountId] ?? post?.overrides[row.provider] ?? post?.text ?? "",
        tags: post?.tags ?? [],
        shape: {
          images: post?.media.filter((item) => item.kind === "image").length ?? 0,
          video:
            post?.media.find((item) => item.kind === "video")?.duration ??
            (post?.media.some((item) => item.kind === "video") ? 0 : null),
          documents: post?.media.filter((item) => item.kind === "document").length ?? 0,
          thread: (post?.thread?.length ?? 0) > 0,
        },
        story: post?.options.instagram?.format === "story",
      });
    }
    return out;
  },
});

/** Clicks on a person's tracked links in the period, by post and network. */
export const clicks = query({
  args: { userId: v.id("users"), postIds: v.array(v.id("socialPosts")) },
  handler: async (ctx, { postIds, userId }) => {
    await requireServer(ctx);
    const out = [];
    for (const postId of postIds.slice(0, 500)) {
      const rows = await ctx.db
        .query("socialLinks")
        .withIndex("by_post", (q) => q.eq("postId", postId))
        .collect();
      for (const row of rows) {
        if (row.userId === userId) out.push({ postId, provider: row.provider, clicks: row.clicks });
      }
    }
    return out;
  },
});

/** Sent copies whose stats are due, leased for a quarter of an hour. With `postId`, that post's, now (its owner asked). */
export const claimMetrics = mutation({
  args: { limit: v.number(), postId: v.optional(v.string()), userId: v.optional(v.id("users")) },
  handler: async (ctx, { limit, postId, userId }) => {
    await requireServer(ctx);
    const now = Date.now();
    let rows: Doc<"socialDeliveries">[];
    if (postId && userId) {
      const post = await ownedPost(ctx, userId, postId);
      if (!post) return [];
      await consume(ctx, `social-metrics:${userId}`, 20, HOUR);
      rows = (await deliveriesOf(ctx, post._id)).filter((row) => row.status === "ok" && row.remoteId && !row.repost);
    } else {
      rows = (
        await ctx.db
          .query("socialDeliveries")
          .withIndex("by_next_metrics", (q) => q.gt("nextMetricsAt", 0).lte("nextMetricsAt", now))
          .take(Math.min(limit, 100))
      ).filter((row) => !row.repost);
    }
    const out = [];
    for (const row of rows) {
      await ctx.db.patch(row._id, { nextMetricsAt: now + 15 * 60_000 });
      const post = await ctx.db.get(row.postId);
      out.push({
        id: row._id,
        postId: row.postId,
        accountId: row.accountId,
        provider: row.provider,
        remoteId: row.remoteId ?? "",
        cid: row.cid,
        url: row.url ?? null,
        // The auto-plug: reply once the copy has this many likes.
        plug: post?.plug && !row.plugged ? post.plug : null,
      });
    }
    return out;
  },
});

export const recordMetrics = mutation({
  args: {
    entries: v.array(
      v.object({
        deliveryId: v.id("socialDeliveries"),
        metrics: v.union(socialMetricsValidator, v.null()),
        plugged: v.optional(v.boolean()),
      }),
    ),
  },
  handler: async (ctx, { entries }) => {
    await requireServer(ctx);
    const now = Date.now();
    for (const { deliveryId, metrics, plugged } of entries) {
      const row = await ctx.db.get(deliveryId);
      if (!row || row.status !== "ok") continue;
      await ctx.db.patch(row._id, {
        ...(metrics ? { metrics, metricsAt: now } : {}),
        ...(plugged ? { plugged: true } : {}),
        nextMetricsAt: nextMetricsAt(row.provider, row.sentAt ?? now, now),
      });
      if (plugged) {
        const post = await ctx.db.get(row.postId);
        if (post)
          await log(
            ctx,
            post,
            "plugged",
            `Auto-plug replied under ${row.handle}'s post on ${NETWORKS[row.provider].label}`,
          );
      }
    }
  },
});

// ---------------------------------------------------------------------------
// Telling the app server when to send.

/**
 * Asks the app server to send what's due on a post (`/api/social/:id`). Like
 * scheduled launches, the request carries only the id: the app server claims
 * the deliveries here, once each.
 */
export const tellApp = internalAction({
  args: { postId: v.id("socialPosts"), attempt: v.number() },
  handler: async (ctx, { postId, attempt }) => {
    try {
      const response = await fetch(`${appBase()}/api/social/${postId}`, {
        method: "POST",
        signal: AbortSignal.timeout(60_000),
      });
      if (!response.ok && response.status !== 404) throw new Error(`The app server answered ${response.status}.`);
    } catch (error) {
      console.error(`Couldn't send social post ${postId} (attempt ${attempt})`, error);
      if (attempt < RETRIES) {
        await ctx.scheduler.runAfter(attempt * 60_000, internal.social.tellApp, { postId, attempt: attempt + 1 });
      }
    }
  },
});

/** Asks the app server about every post with something due: used when a paused studio resumes. */
export async function wakeDuePosts(ctx: MutationCtx, userId: Id<"users">) {
  const now = Date.now();
  const posts = await ctx.db
    .query("socialPosts")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(200);
  for (const post of posts) {
    if (post.draft || post.cancelled || (post.scheduledAt !== null && post.scheduledAt > now)) continue;
    const rows = await deliveriesOf(ctx, post._id);
    if (rows.some((row) => row.status === "queued" || row.status === "processing")) {
      await ctx.scheduler.runAfter(0, internal.social.tellApp, { postId: post._id, attempt: 1 });
    }
  }
}

/**
 * The backstop, from a cron. A copy still "sending" past its lease may
 * have gone out before its caller died, so it's marked uncertain rather
 * than sent again; processing uploads and scheduled posts nobody picked up
 * are asked about again.
 */
export const backstop = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const lost = await ctx.db
      .query("socialDeliveries")
      .withIndex("by_lease", (q) => q.eq("status", "sending").lt("leaseUntil", now))
      .take(100);
    for (const row of lost) {
      await ctx.db.patch(row._id, {
        status: "error",
        leaseUntil: undefined,
        uncertain: true,
        message: "Slopper lost track of this one. Check the account before you retry.",
      });
    }
    const posts = new Set<Id<"socialPosts">>();
    const stalled = await ctx.db
      .query("socialDeliveries")
      .withIndex("by_next_attempt", (q) => q.gt("nextAttemptAt", 0).lt("nextAttemptAt", now - 5 * 60_000))
      .take(50);
    for (const row of stalled) if (row.status === "processing") posts.add(row.postId);
    const late = await ctx.db
      .query("socialPosts")
      .withIndex("by_scheduled", (q) => q.gt("scheduledAt", now - DAY).lt("scheduledAt", now - 5 * 60_000))
      .take(50);
    for (const post of late) {
      if (post.cancelled || post.draft) continue;
      const rows = await deliveriesOf(ctx, post._id);
      if (rows.some((row) => row.status === "queued" && (row.notBefore ?? 0) < now)) posts.add(post._id);
    }
    for (const postId of posts) await ctx.scheduler.runAfter(0, internal.social.tellApp, { postId, attempt: 1 });
  },
});

/** Asks the app server to read the stats that are due (`/api/social/metrics`) and new feed items (`/api/social/feeds`). */
export const syncMetrics = internalAction({
  args: {},
  handler: async () => {
    for (const path of ["metrics", "feeds"]) {
      try {
        const response = await fetch(`${appBase()}/api/social/${path}`, {
          method: "POST",
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok && response.status !== 404) throw new Error(`The app server answered ${response.status}.`);
      } catch (error) {
        console.error(`Couldn't sync social ${path}`, error);
      }
    }
  },
});

/** For tests: a delivery as Convex holds it. */
export const delivery = query({
  args: { deliveryId: v.id("socialDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    await requireServer(ctx);
    return await ctx.db.get(deliveryId);
  },
});

/** A person's own uploads, as the studio checks them before posting. Others' ids come back empty. */
export const mediaForOwner = query({
  args: { ownerId: v.id("users"), mediaIds: v.array(v.string()) },
  handler: async (ctx, { ownerId, mediaIds }) => {
    await requireServer(ctx);
    const found = [];
    for (const raw of mediaIds.slice(0, 12)) {
      const id = ctx.db.normalizeId("media", raw);
      const media = id ? await ctx.db.get(id) : null;
      if (!media || media.ownerId !== ownerId || media.orphanedAt !== undefined) continue;
      const kind = isVideo(media)
        ? "video"
        : isImage(media)
          ? "image"
          : media.contentType === "application/pdf"
            ? "document"
            : null;
      if (!kind) continue;
      found.push({
        id: media._id,
        kind,
        url: await mediaUrl(ctx, media),
        contentType: media.contentType,
        size: media.size,
      });
    }
    return found;
  },
});

export interface ClaimedPost {
  post: Doc<"socialPosts">;
  deliveries: Doc<"socialDeliveries">[];
  media: Awaited<ReturnType<typeof mediaFor>>;
  coverUrl: string | null;
  originals: { provider: Doc<"socialDeliveries">["provider"]; remoteId: string; cid?: string; url: string }[];
  links: { provider: Doc<"socialDeliveries">["provider"]; code: string }[];
}
