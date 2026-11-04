import { createHmac } from "node:crypto";
import { api } from "@convex/_generated/api";
import type { Doc, Id } from "@convex/_generated/dataModel";
import type { ClaimedPost } from "@convex/social";
import { fitText, measureFor } from "~/lib/compose";
import {
  isSocialProvider,
  NETWORKS,
  type NetworkOptions,
  optionProblems,
  type PostShape,
  type SocialProvider,
  textLimitFor,
  unsupportedReason,
} from "~/lib/networks";
import { personalize } from "~/lib/variables";
import { absoluteUrl, config, type ContentCheckConfig } from "../config";
import { convex, convexMessage } from "../convex";
import { parseWebUrl } from "../forms";
import { checkContent, type Submission } from "../moderation";
import { publicFetch } from "../preview";
import { adapters } from "./adapters";
import type {
  ConnectedAccount,
  Draft,
  DraftMedia,
  PostMetrics,
  ReplyRef,
  SendResult,
  SocialAdapter,
  SocialComment,
} from "./core";
import { SocialError } from "./core";

/**
 * The studio: one post, written once, sent as many accounts on many
 * networks, each copy fitted to its network. Convex keeps the post and one
 * delivery per account (convex/social.ts); this server checks the post,
 * holds the credentials and does the sending.
 *
 * Nothing goes out unless the content check said "ok" for everything that
 * will be public: the words (thread, first comment and auto-plug included),
 * the pictures and the video (or, for videos too big to send to the check,
 * the frames the browser took from it, each checked as it was uploaded).
 */

export const STUDIO_LIMITS = {
  textLength: 5000,
  media: 10,
  threadPosts: 25,
  /** Videos up to this size go to the check whole; bigger ones by their frames. */
  inlineVideoBytes: 20 * 1024 * 1024,
};

export interface StudioInput {
  /** Set to change a draft or a scheduled post instead of making one. */
  postId?: string | null;
  text: string;
  link: string;
  productId: string | null;
  accountIds: string[];
  /** Accounts that repost another account's copy on the same network. */
  repostAccountIds?: string[];
  media: { id: string; duration?: number; width?: number; height?: number; alt?: string; coverAt?: number }[];
  /** Frames the browser took from the video, uploaded (and checked) as pictures. */
  frames: string[];
  overrides: Record<string, string>;
  options: NetworkOptions;
  /** Epoch ms, or null to post now (or to take the next queue slot when `queue` is set). */
  scheduledAt: number | null;
  queue?: boolean;
  draft?: boolean;
  thread?: string[];
  firstComment?: string;
  note?: string;
  tags?: string[];
  repeat?: { everyDays: number; remaining: number } | null;
  staggerMinutes?: number;
  plug?: { likes: number; text: string } | null;
  trackLinks?: boolean;
  coverMediaId?: string | null;
  idempotencyKey?: string;
  source?: "web" | "api" | "rss" | "csv";
}

export type StudioResult =
  | { ok: true; postId: Id<"socialPosts">; scheduled: boolean; draft: boolean; scheduledAt: number | null }
  | { ok: false; error: string };

function fail(error: string): StudioResult {
  return { ok: false, error };
}

// ---------------------------------------------------------------------------
// The posting queue and best times.

const DAY = 86_400_000;

/** Weekday and minutes after midnight of `at` in `timeZone`. */
export function zonedParts(at: number, timeZone: string): { day: number; minute: number } {
  let zone = timeZone;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
  } catch {
    zone = "UTC";
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(at));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "0";
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return { day, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/**
 * The next queue slot after `after` that no scheduled post holds (within 5
 * minutes), in the person's time zone. Looks four weeks ahead.
 */
export function nextQueueSlot(
  slots: readonly { day: number; minute: number }[],
  taken: readonly number[],
  timeZone: string,
  after = Date.now(),
): number | null {
  if (slots.length === 0) return null;
  const wanted = new Set(slots.map((slot) => slot.day * 1440 + Math.floor(slot.minute / 5) * 5));
  const start = Math.ceil((after + 60_000) / 300_000) * 300_000;
  for (let at = start; at < after + 28 * DAY; at += 300_000) {
    const { day, minute } = zonedParts(at, timeZone);
    if (!wanted.has(day * 1440 + minute)) continue;
    if (taken.some((time) => Math.abs(time - at) < 5 * 60_000)) continue;
    return at;
  }
  return null;
}

export interface SentForTimes {
  sentAt: number;
  metrics: PostMetrics | null;
}

/**
 * When this person's posts have done best: average engagement by weekday
 * and hour in their time zone, from what they've sent. With fewer than 8
 * posts that have stats, the usual good times for social posts instead.
 */
export function bestTimes(
  sent: readonly SentForTimes[],
  timeZone: string,
): { day: number; minute: number; reason: "yours" | "typical" }[] {
  const scored = sent.filter((row) => row.metrics);
  if (scored.length < 8) {
    return [
      { day: 2, minute: 9 * 60, reason: "typical" },
      { day: 3, minute: 12 * 60, reason: "typical" },
      { day: 4, minute: 17 * 60, reason: "typical" },
    ];
  }
  const buckets = new Map<number, { total: number; count: number }>();
  for (const row of scored) {
    const { day, minute } = zonedParts(row.sentAt, timeZone);
    const key = day * 24 + Math.floor(minute / 60);
    const m = row.metrics!;
    const engagement =
      (m.likes ?? 0) + 2 * (m.comments ?? 0) + 2 * (m.shares ?? 0) + 2 * (m.reposts ?? 0) + (m.saves ?? 0);
    const bucket = buckets.get(key) ?? { total: 0, count: 0 };
    buckets.set(key, { total: bucket.total + engagement, count: bucket.count + 1 });
  }
  return [...buckets.entries()]
    .sort(([, a], [, b]) => b.total / b.count - a.total / a.count)
    .slice(0, 3)
    .map(([key]) => ({ day: Math.floor(key / 24), minute: (key % 24) * 60, reason: "yours" as const }));
}

/** The next time at weekday `day`, `minute` after midnight in `timeZone`. */
export function nextAt(day: number, minute: number, timeZone: string, after = Date.now()): number {
  return nextQueueSlot([{ day, minute }], [], timeZone, after) ?? after + DAY;
}

// ---------------------------------------------------------------------------
// Making and changing posts.

type Services = { check: ContentCheckConfig | null; videoCheck: ContentCheckConfig | null };

export async function saveStudioPost(
  user: Pick<Doc<"users">, "_id" | "timeZone">,
  input: StudioInput,
  services: Services = { check: config.contentCheck, videoCheck: config.videoCheck },
): Promise<StudioResult> {
  const text = input.text.trim();
  if (text.length > STUDIO_LIMITS.textLength) return fail(`Keep it under ${STUDIO_LIMITS.textLength} characters.`);
  const thread = (input.thread ?? []).map((part) => part.trim()).filter(Boolean);
  if (thread.length > STUDIO_LIMITS.threadPosts) {
    return fail(`A thread takes up to ${STUDIO_LIMITS.threadPosts + 1} posts.`);
  }
  if (thread.some((part) => part.length > STUDIO_LIMITS.textLength))
    return fail("One of the thread's posts is too long.");
  let link: string | null = null;
  if (input.link.trim()) {
    const url = parseWebUrl(input.link.trim());
    if (!url) return fail("That link isn't a web address.");
    link = url.href;
  }
  if (input.media.length > STUDIO_LIMITS.media) return fail(`Add up to ${STUDIO_LIMITS.media} pictures.`);
  if (!text && input.media.length === 0) return fail("Write something or add a picture or video.");

  let scheduledAt = input.scheduledAt;
  if (!input.draft && input.queue) {
    const [settings, taken] = await Promise.all([
      convex.query(api.studio.settings, { userId: user._id }),
      convex.query(api.social.scheduledTimes, { userId: user._id }),
    ]);
    scheduledAt = nextQueueSlot(settings.slots, taken, user.timeZone);
    if (scheduledAt === null) {
      return fail("Your queue has no free time in the next four weeks. Add times in Studio settings.");
    }
  }
  if (scheduledAt !== null && !input.draft) {
    if (!Number.isFinite(scheduledAt) || scheduledAt < Date.now() - 60_000) return fail("Pick a time in the future.");
    if (scheduledAt > Date.now() + 365 * DAY) return fail("Schedule up to a year ahead.");
  }

  const [accounts, media] = await Promise.all([
    convex.query(api.accounts.list, { userId: user._id }),
    convex.query(api.social.mediaForOwner, { ownerId: user._id, mediaIds: input.media.map((item) => item.id) }),
  ]);
  if (media.length !== input.media.length) return fail("One of your uploads is gone. Add it again.");
  const picked = accounts.filter((account) => input.accountIds.includes(account._id));
  if (picked.length === 0) return fail("Pick at least one account to post as.");
  if (new Set(input.accountIds).size !== picked.length)
    return fail("One of those accounts isn't available. Choose it again.");

  const video = media.find((item) => item.kind === "video");
  const videoInput = video ? input.media.find((item) => item.id === video.id) : undefined;
  const shape: PostShape = {
    images: media.filter((item) => item.kind === "image").length,
    video: video ? (videoInput?.duration ?? 0) : null,
    documents: media.filter((item) => item.kind === "document").length,
  };
  if (media.filter((item) => item.kind === "video").length > 1) return fail("Add one video per post.");
  const providers = new Set(picked.map((account) => account.provider));
  if (!input.draft) {
    for (const account of picked) {
      const reason = unsupportedReason(account.provider, shape);
      if (reason) return fail(`${reason} Untick ${account.handle} or change the post.`);
    }
    const problems = optionProblems(providers, input.options);
    if (problems.length) return fail(problems[0]);
  }

  const pickedIds = new Set(picked.map((account) => String(account._id)));
  const overrides: Record<string, string> = {};
  for (const [key, words] of Object.entries(input.overrides)) {
    if (((isSocialProvider(key) && providers.has(key)) || pickedIds.has(key)) && words.trim()) {
      overrides[key] = words.trim().slice(0, 25_000);
    }
  }

  if (!input.draft) {
    const problem = await checkPost(user._id, { text, link, overrides, thread, input, media, video, services });
    if (problem) return fail(problem);
  }

  const fields = {
    productId: input.productId,
    text,
    link,
    media: input.media.map(({ id, duration, width, height, alt, coverAt }) => ({
      mediaId: id,
      duration,
      width,
      height,
      alt,
      coverAt,
    })),
    overrides,
    options: input.options,
    accountIds: picked.map((account) => account._id),
    repostAccountIds: input.repostAccountIds ?? [],
    scheduledAt: input.draft ? (input.scheduledAt ?? null) : scheduledAt,
    thread,
    firstComment: input.firstComment ?? "",
    note: input.note ?? "",
    tags: input.tags ?? [],
    draft: input.draft ?? false,
    repeat: input.repeat ?? undefined,
    staggerMinutes: input.staggerMinutes ?? 0,
    plug: input.plug ?? undefined,
    trackLinks: input.trackLinks ?? false,
    coverMediaId: input.coverMediaId ?? undefined,
  };
  let postId: Id<"socialPosts">;
  try {
    postId = input.postId
      ? await convex.mutation(api.social.update, { userId: user._id, postId: input.postId, ...fields })
      : await convex.mutation(api.social.create, {
          userId: user._id,
          ...fields,
          idempotencyKey: input.idempotencyKey,
          source: input.source ?? "web",
        });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return fail(message);
    throw error;
  }
  if (!input.draft && fields.scheduledAt === null) await deliver(postId);
  return {
    ok,
    postId,
    scheduled: !input.draft && fields.scheduledAt !== null,
    draft: input.draft ?? false,
    scheduledAt: fields.scheduledAt,
  };
}

const ok = true as const;

/** Kept for callers from before drafts: makes a post. */
export async function createStudioPost(
  user: Pick<Doc<"users">, "_id" | "timeZone">,
  input: StudioInput,
  services?: Services,
): Promise<StudioResult> {
  return await saveStudioPost(user, input, services);
}

type OwnedMedia = Awaited<ReturnType<typeof convex.query<typeof api.social.mediaForOwner>>>;

/** Runs the content check on everything public in a post. Returns why it can't go, or null. */
async function checkPost(
  userId: Id<"users">,
  post: {
    text: string;
    link: string | null;
    overrides: Record<string, string>;
    thread: string[];
    input: StudioInput;
    media: OwnedMedia;
    video: OwnedMedia[number] | undefined;
    services: Services;
  },
): Promise<string | null> {
  const { video, services, input } = post;
  const frames = video
    ? await convex.query(api.social.mediaForOwner, { ownerId: userId, mediaIds: input.frames.slice(0, 3) })
    : [];
  if (video && video.size > STUDIO_LIMITS.inlineVideoBytes && frames.length === 0) {
    return "Couldn't read frames from that video to check it. Try another browser.";
  }
  const cover = input.coverMediaId
    ? await convex.query(api.social.mediaForOwner, { ownerId: userId, mediaIds: [input.coverMediaId] })
    : [];
  const imageUrls = [...post.media.filter((item) => item.kind === "image"), ...frames, ...cover]
    .map((item) => item.url)
    .filter((url): url is string => url !== null);
  const document = post.media.find((item) => item.kind === "document");
  const alts = input.media.map((item) => item.alt ?? "").filter(Boolean);
  const submission: Submission = {
    fields: {
      kind: "social post",
      text: post.text,
      ...(post.link ? { link: post.link } : {}),
      ...Object.fromEntries(Object.entries(post.overrides).map(([provider, words]) => [`text for ${provider}`, words])),
      ...(post.thread.length ? { thread: post.thread } : {}),
      ...(input.firstComment?.trim() ? { "first comment": input.firstComment.trim() } : {}),
      ...(input.plug?.text.trim() ? { "reply once it takes off": input.plug.text.trim() } : {}),
      ...(input.options.youtube?.title ? { "YouTube title": input.options.youtube.title } : {}),
      ...(input.options.linkedin?.documentTitle ? { "document title": input.options.linkedin.documentTitle } : {}),
      ...(alts.length ? { "alt text": alts } : {}),
    },
    images: imageUrls.map((url) => ({ url })),
    ...(video?.url && video.size <= STUDIO_LIMITS.inlineVideoBytes
      ? { video: { url: video.url, contentType: video.contentType } }
      : {}),
    ...(document?.url ? { file: { url: document.url, fileName: "document.pdf", contentType: "application/pdf" } } : {}),
  };
  const settings = submission.video ? services.videoCheck : services.check;
  if (!settings) return "Posting needs the content check, and it isn't set up on this server.";
  let verdict: string;
  try {
    verdict = (await checkContent(submission, settings)).verdict;
  } catch (error) {
    console.error("Studio content check failed", error);
    return "The content check couldn't run just now. Try again in a minute.";
  }
  if (verdict === "blocked") return "This can't be posted from Slopper.";
  if (verdict !== "ok") return "The check marked this as mature, so Slopper won't post it to your accounts.";
  return null;
}

/**
 * Whether a post may be shown on a public preview link: drafts haven't been
 * checked, and the link is a page on Slopper, so it runs the check first.
 * Returns why not, or null.
 */
export async function checkForPreview(
  userId: Id<"users">,
  postId: string,
  settings: ContentCheckConfig | null = config.contentCheck,
): Promise<string | null> {
  const post = await convex.query(api.social.get, { userId, postId });
  if (!post) return "That post is gone.";
  if (!settings) return "Preview links need the content check, and it isn't set up on this server.";
  const images = post.media.filter((item) => item.kind === "image" && item.url).map((item) => ({ url: item.url! }));
  try {
    const check = await checkContent(
      {
        fields: {
          kind: "social post preview",
          text: post.text,
          ...(post.link ? { link: post.link } : {}),
          ...(post.thread.length ? { thread: post.thread } : {}),
          ...(post.firstComment ? { "first comment": post.firstComment } : {}),
          ...Object.fromEntries(
            Object.entries(post.overrides).map(([provider, words]) => [`text for ${provider}`, words]),
          ),
          ...(post.options.youtube?.title ? { "YouTube title": post.options.youtube.title } : {}),
        },
        images,
      },
      settings,
    );
    return check.verdict === "ok" ? null : "This can't go on a public preview link.";
  } catch {
    return "The content check couldn't run just now. Try again in a minute.";
  }
}

// ---------------------------------------------------------------------------
// Sending.

interface DraftContext {
  timeZone: string;
  product: string | null;
}

/** The link `provider` gets: the tracked short link when there is one. */
function linkFor(provider: SocialProvider, claimed: Pick<ClaimedPost, "post" | "links">): string | null {
  const tracked = claimed.links.find((row) => row.provider === provider);
  return tracked ? absoluteUrl(`/go/${tracked.code}`) : claimed.post.link;
}

/** Fits words to one account: its limit, its link (where links work), its spintax and variables filled in. */
export function wordsFor(
  provider: SocialProvider,
  post: Pick<Doc<"socialPosts">, "text" | "link" | "overrides">,
  options: {
    account?: Pick<ConnectedAccount, "_id" | "longPosts">;
    link?: string | null;
    context?: DraftContext;
    at?: number;
  } = {},
): string {
  const link = options.link === undefined ? post.link : options.link;
  const raw =
    (options.account ? post.overrides[options.account._id]?.trim() : undefined) ||
    post.overrides[provider]?.trim() ||
    post.text;
  const words = options.context
    ? personalize(raw, options.account?._id ?? provider, {
        at: options.at ?? Date.now(),
        timeZone: options.context.timeZone,
        product: options.context.product,
        link,
        network: NETWORKS[provider].label,
      })
    : raw;
  const measure = measureFor(provider);
  const unclickable = provider === "instagram" || provider === "tiktok";
  const suffix = link && !unclickable && !words.includes(link) ? `\n\n${link}` : "";
  const budget = textLimitFor(provider, options.account);
  return fitText(words.trim(), budget - measure(suffix), measure) + suffix;
}

/** One account's copy of a claimed post. */
export function draftFor(account: ConnectedAccount, claimed: ClaimedPost, context: DraftContext): Draft {
  const media: DraftMedia[] = claimed.media
    .filter((item): item is typeof item & { url: string } => item.url !== null)
    .map((item) => ({
      kind: item.kind,
      url: item.url,
      contentType: item.contentType,
      size: item.size,
      duration: item.duration,
      width: item.width,
      height: item.height,
      alt: item.alt,
      coverAt: item.coverAt,
    }));
  const link = linkFor(account.provider, claimed);
  return {
    text: wordsFor(account.provider, claimed.post, { account, link, context }),
    link,
    media,
    options: claimed.post.options,
    thumbnailUrl: claimed.coverUrl,
  };
}

type Recorded = Parameters<typeof convex.mutation<typeof api.social.record>>[1]["result"];

export function outcome(result: SendResult): Recorded {
  return result.status === "ok"
    ? {
        status: "ok",
        remoteId: result.post.remoteId,
        url: result.post.url,
        ...(result.post.cid ? { cid: result.post.cid } : {}),
      }
    : { status: "processing", pending: result.pending, retryAfterMs: result.retryAfterMs };
}

/** What a send's failure is stored as. Anything but a network's refusal may have posted, so it's uncertain. */
export function failure(error: unknown): Recorded {
  if (error instanceof SocialError) return { status: "error", message: error.message, uncertain: error.uncertain };
  console.error("A studio post failed", error);
  return {
    status: "error",
    message: "The connection dropped while posting. Check the account before you retry.",
    uncertain: true,
  };
}

/** Whether a refusal means the account's connection is gone (so the person should reconnect it). */
export function brokenReason(error: unknown): string | null {
  if (!(error instanceof SocialError)) return null;
  if (error.status === 401) return `${error.message} Reconnect the account.`;
  if (/reconnect/i.test(error.message)) return error.message;
  return null;
}

/**
 * The words after the post: the thread's later posts (on networks that
 * thread), then the first comment. Each replies to the one before. A part
 * that fails stops the rest and leaves a warning; the post itself stands.
 * Passing `existingParts` resumes from where an earlier try stopped.
 */
export async function followUps(
  adapter: SocialAdapter,
  account: ConnectedAccount,
  root: { remoteId: string; cid?: string },
  post: Pick<Doc<"socialPosts">, "thread" | "firstComment">,
  context: DraftContext,
  existingParts: readonly string[] = [],
): Promise<{ parts: string[]; warning: string | null }> {
  const spec = NETWORKS[account.provider];
  const threaded = spec.threads ? (post.thread ?? []) : [];
  const texts = [...threaded, ...(spec.firstComment && post.firstComment ? [post.firstComment] : [])];
  if (texts.length === 0 || !adapter.reply) return { parts: [...existingParts], warning: null };
  const parts: string[] = [...existingParts];
  let parent: ReplyRef = {
    remoteId: parts.at(-1) ?? root.remoteId,
    cid: parts.length === 0 ? root.cid : undefined,
    rootId: root.remoteId,
    rootCid: root.cid,
  };
  for (let index = parts.length; index < texts.length; index++) {
    const raw = texts[index];
    const words = wordsFor(
      account.provider,
      { text: raw, link: null, overrides: {} },
      { account, link: null, context },
    );
    try {
      const reply = await adapter.reply(account, parent, words);
      parts.push(reply.remoteId);
      parent = { ...parent, remoteId: reply.remoteId, cid: reply.cid };
    } catch (error) {
      const why = error instanceof SocialError ? error.message : "the connection dropped";
      return {
        parts,
        warning:
          index >= threaded.length
            ? `The first comment didn't go: ${why}`
            : `The thread stopped at post ${index + 2}: ${why}`,
      };
    }
  }
  return { parts, warning: null };
}

async function contextFor(claimed: ClaimedPost): Promise<DraftContext> {
  const [user, product] = await Promise.all([
    convex.query(api.users.get, { userId: claimed.post.userId }),
    claimed.post.productId ? convex.query(api.slops.getForServer, { slopId: claimed.post.productId }) : null,
  ]);
  return { timeZone: user?.timeZone ?? "UTC", product: product?.name ?? null };
}

async function deliverPass(
  postId: string,
  userId: Id<"users"> | undefined,
  networks: Record<SocialProvider, SocialAdapter>,
): Promise<{ handled: number; publishedOriginal: boolean }> {
  const claimed = await convex.mutation(api.social.claim, { postId, userId });
  if (!claimed) return { handled: 0, publishedOriginal: false };
  const accounts = new Map<string, ConnectedAccount>(
    (await convex.query(api.accounts.list, { userId: claimed.post.userId })).map((account) => [account._id, account]),
  );
  const context = await contextFor(claimed);
  const events: { event: string; row: Doc<"socialDeliveries">; result: Recorded }[] = [];

  await Promise.all(
    claimed.deliveries.map(async (row) => {
      const account = accounts.get(row.accountId);
      let result: Recorded;
      if (!account) {
        result = { status: "skipped", message: "That account was disconnected." };
      } else {
        const adapter = networks[account.provider];
        try {
          if (row.repost) {
            const original = claimed.originals.find((item) => item.provider === account.provider);
            if (!original || !adapter.amplify) {
              result = { status: "skipped", message: "Nothing on this network to repost." };
            } else {
              await adapter.amplify(account, original);
              result = { status: "ok", remoteId: original.remoteId, url: original.url };
            }
          } else {
            const draft = draftFor(account, claimed, context);
            result =
              row.status === "processing" && row.pending && adapter.resume
                ? outcome(await adapter.resume(account, row.pending, draft))
                : outcome(await adapter.send(account, draft));
          }
        } catch (error) {
          result = failure(error);
          const broken = brokenReason(error);
          if (broken) await convex.mutation(api.accounts.markBroken, { accountId: account._id, reason: broken });
        }
      }
      await convex.mutation(api.social.record, { deliveryId: row._id, result });
      if (result.status === "ok" && !row.repost && account) {
        const done = await followUps(
          networks[account.provider],
          account,
          { remoteId: result.remoteId, cid: result.cid },
          claimed.post,
          context,
        );
        if (done.parts.length || done.warning) {
          await convex.mutation(api.social.recordParts, {
            deliveryId: row._id,
            parts: done.parts,
            warning: done.warning,
          });
        }
      }
      if (result.status === "ok" || result.status === "error") {
        events.push({ event: result.status === "ok" ? "post.published" : "post.failed", row, result });
      }
    }),
  );
  for (const { event, row, result } of events) {
    await sendWebhook(claimed.post.userId, event, {
      postId: claimed.post._id,
      network: row.provider,
      account: row.handle,
      repost: row.repost ?? false,
      ...(result.status === "ok" ? { url: result.url } : result.status === "error" ? { error: result.message } : {}),
    });
  }
  return {
    handled: claimed.deliveries.length,
    publishedOriginal: events.some((item) => item.event === "post.published" && !item.row.repost),
  };
}

/**
 * Sends what's due on a post: every queued copy, uploads due another look,
 * then reposts of what went out. Each account runs on its own, so one
 * network failing never stops the others. Returns how many copies it handled.
 */
export async function deliver(
  postId: string,
  userId?: Id<"users">,
  networks: Record<SocialProvider, SocialAdapter> = adapters(),
): Promise<number> {
  const first = await deliverPass(postId, userId, networks);
  if (!first.publishedOriginal) return first.handled;
  const second = await deliverPass(postId, userId, networks);
  return first.handled + second.handled;
}

/**
 * Tells the person's webhook what happened, signed with their secret:
 * `x-slopper-signature: sha256=<hex HMAC of the body>`. The address is one
 * they typed, so it goes through the pinned transport like every such fetch.
 */
export async function sendWebhook(userId: Id<"users">, event: string, data: Record<string, unknown>): Promise<void> {
  const settings = await convex.query(api.studio.settings, { userId });
  if (!settings.webhook) return;
  const body = JSON.stringify({ event, at: new Date().toISOString(), data });
  const signature = createHmac("sha256", settings.webhook.secret).update(body).digest("hex");
  let status: string;
  try {
    const response = await publicFetch(new URL(settings.webhook.url), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-slopper-event": event,
        "x-slopper-signature": `sha256=${signature}`,
      },
      body,
      timeoutMs: 10_000,
      loopback: process.env.SLOPPER_ALLOW_LOCAL_FETCH === "1",
    });
    status = String(response.status);
  } catch (error) {
    status = error instanceof Error ? error.message.slice(0, 80) : "failed";
  }
  await convex.mutation(api.studio.recordWebhook, { userId, status });
}

/**
 * Reads the stats that are due (or one post's, when its owner asks), one
 * call per account where the network takes several posts at once. A copy
 * past its auto-plug threshold gets its reply.
 */
export async function syncMetrics(
  scope: { postId: string; userId: Id<"users"> } | null = null,
  networks: Record<SocialProvider, SocialAdapter> = adapters(),
): Promise<number> {
  const due = await convex.mutation(api.social.claimMetrics, { limit: 100, ...scope });
  if (due.length === 0) return 0;
  const byAccount = new Map<string, typeof due>();
  for (const row of due) byAccount.set(row.accountId, [...(byAccount.get(row.accountId) ?? []), row]);
  const entries: { deliveryId: Id<"socialDeliveries">; metrics: PostMetrics | null; plugged?: boolean }[] = [];
  for (const [accountId, rows] of byAccount) {
    const account = await convex.query(api.accounts.get, { accountId: accountId as Id<"accounts"> });
    const adapter = account ? networks[account.provider] : null;
    let found = new Map<string, PostMetrics>();
    if (account && adapter?.metrics) {
      try {
        found = await adapter.metrics(
          account,
          rows.map(({ remoteId, url }) => ({ remoteId, url })),
        );
      } catch (error) {
        console.warn(`Reading stats for a ${account.provider} account failed`, error);
      }
    }
    for (const row of rows) {
      const metrics = clean(found.get(row.remoteId));
      let plugged = false;
      if (account && adapter?.reply && row.plug && (metrics?.likes ?? 0) >= row.plug.likes) {
        try {
          await adapter.reply(
            account,
            { remoteId: row.remoteId, cid: row.cid, rootId: row.remoteId, rootCid: row.cid },
            row.plug.text,
          );
          plugged = true;
        } catch (error) {
          console.warn("An auto-plug reply failed", error);
        }
      }
      entries.push({ deliveryId: row.id, metrics, ...(plugged ? { plugged } : {}) });
    }
  }
  await convex.mutation(api.social.recordMetrics, { entries });
  return entries.length;
}

/** Drops counts a network didn't give, so Convex's validator sees only numbers. */
function clean(metrics: PostMetrics | undefined): PostMetrics | null {
  if (!metrics) return null;
  return Object.fromEntries(Object.entries(metrics).filter(([, value]) => typeof value === "number"));
}

// ---------------------------------------------------------------------------
// After sending: taking down, reading and answering comments.

async function ownedSent(user: Pick<Doc<"users">, "_id">, deliveryId: string) {
  const row = await convex.query(api.social.ownedDelivery, { userId: user._id, deliveryId });
  if (!row || row.status !== "ok" || !row.remoteId || row.repost) return null;
  const account = await convex.query(api.accounts.get, { accountId: row.accountId });
  return account && account.userId === user._id ? { row, account } : null;
}

/** Takes one sent copy down from its network. Returns why it couldn't, or null. */
export async function removeDelivery(
  user: Pick<Doc<"users">, "_id">,
  deliveryId: string,
  networks: Record<SocialProvider, SocialAdapter> = adapters(),
): Promise<string | null> {
  const found = await ownedSent(user, deliveryId);
  if (!found) return "That copy isn't up any more.";
  const adapter = networks[found.account.provider];
  if (!adapter.remove) {
    return `${NETWORKS[found.account.provider].label} doesn't let apps take posts down. Delete it there.`;
  }
  try {
    await adapter.remove(found.account, found.row.remoteId!);
  } catch (error) {
    return error instanceof SocialError ? error.message : "Couldn't take it down. Try again.";
  }
  await convex.mutation(api.social.markRemoved, { userId: user._id, deliveryId });
  return null;
}

/** The latest comments on one sent copy. */
export async function commentsFor(
  user: Pick<Doc<"users">, "_id">,
  deliveryId: string,
  networks: Record<SocialProvider, SocialAdapter> = adapters(),
): Promise<{ comments: SocialComment[]; error: string | null }> {
  const found = await ownedSent(user, deliveryId);
  if (!found) return { comments: [], error: null };
  const adapter = networks[found.account.provider];
  if (!adapter.comments) return { comments: [], error: null };
  try {
    const comments = await adapter.comments(found.account, { remoteId: found.row.remoteId!, cid: found.row.cid });
    return { comments: comments.slice(0, 25), error: null };
  } catch (error) {
    return { comments: [], error: error instanceof SocialError ? error.message : "Couldn't read the comments." };
  }
}

/** Answers a comment (or the post itself) as the account that posted it, after the content check. */
export async function replyTo(
  user: Pick<Doc<"users">, "_id">,
  deliveryId: string,
  target: { commentId: string | null; cid?: string },
  text: string,
  networks: Record<SocialProvider, SocialAdapter> = adapters(),
): Promise<string | null> {
  const words = text.trim();
  if (!words) return "Write a reply first.";
  const found = await ownedSent(user, deliveryId);
  if (!found) return "That copy isn't up any more.";
  const spec = NETWORKS[found.account.provider];
  if (!spec.comments?.replies) return `${spec.label} doesn't let apps reply.`;
  const limit = textLimitFor(found.account.provider, found.account);
  if (measureFor(found.account.provider)(words) > limit) return `${spec.label} takes up to ${limit} characters.`;
  if (!config.contentCheck) return "Replying needs the content check, and it isn't set up on this server.";
  try {
    const check = await checkContent(
      { fields: { kind: "social reply", text: words }, images: [] },
      config.contentCheck,
    );
    if (check.verdict !== "ok") return "That reply can't be posted from Slopper.";
  } catch {
    return "The content check couldn't run just now. Try again in a minute.";
  }
  const adapter = networks[found.account.provider];
  if (!adapter.reply) return `${spec.label} doesn't let apps reply.`;
  const root = { remoteId: found.row.remoteId!, cid: found.row.cid };
  const parent: ReplyRef = target.commentId
    ? { remoteId: target.commentId, cid: target.cid, rootId: root.remoteId, rootCid: root.cid, kind: "comment" }
    : { ...root, rootId: root.remoteId, rootCid: root.cid, kind: "post" };
  try {
    await adapter.reply(found.account, parent, words);
  } catch (error) {
    return error instanceof SocialError ? error.message : "Couldn't reply. Try again.";
  }
  await convex.mutation(api.social.logActivity, {
    userId: user._id,
    postId: found.row.postId,
    kind: "replied",
    detail: `Replied as ${found.account.handle} on ${spec.label}`,
  });
  return null;
}
