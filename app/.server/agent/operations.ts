import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import type { Doc } from "@convex/_generated/dataModel";
import type { Vote } from "@convex/lib/shape";
import {
  CATEGORIES,
  COST_CATEGORIES,
  FIELD_OUTCOMES,
  findCategory,
  LIMITS,
  LINK_KINDS,
  POSTABLE_UPDATE_KINDS,
  REVENUE_CATEGORIES,
  REVIEW_EXPERIENCES,
} from "~/lib/model";
import { localDate, utcDate } from "~/lib/dates";
import { editableUntil } from "~/lib/editing";
import { normalizeQuery, SEARCH_LIMIT, SEARCH_QUERY_LENGTH, SEARCH_RATE_LIMIT_MESSAGE } from "~/lib/search";
import { formatRelease, parseRelease, releaseProblem } from "~/lib/schedule";
import { listWords, slopPath } from "~/lib/display";
import { CURRENCIES } from "~/lib/money";
import { tractionBoard } from "~/lib/traction";
import { videoPageUrl } from "~/lib/video";
import { TAG_KINDS, tagOptions } from "~/lib/tags";
import { absoluteUrl, autopostNetworks, config } from "../config";
import { convex, convexMessage } from "../convex";
import { validateGoal, validateReview, validateSlop, validateUpdate } from "../forms";
import { deleteOrphanedMedia, uploadImage, uploadPublication, uploadVideo } from "../media";
import { checkedContent, checkSlop, checkVideo } from "../moderation";
import { finishLaunch, releaseScheduled } from "../launch";
import { announce } from "../social/announce";
import { saveStudioPost, wordsFor } from "../social/studio";
import { wallTime } from "~/lib/csv";
import {
  NETWORK_LABELS,
  optionProblems,
  textLimitFor,
  unsupportedReason,
  type NetworkOptions,
  TIKTOK_PRIVACY,
  YOUTUBE_PRIVACY,
  INSTAGRAM_FORMATS,
} from "~/lib/networks";
import { measureFor } from "~/lib/compose";
import { personalize } from "~/lib/variables";
import { postUpdate } from "../updates";
import { postReview } from "../reviews";
import type { User } from "../session";
import {
  ApiError,
  asObject,
  type JsonObject,
  optionalBoolean,
  optionalFeatures,
  optionalLinks,
  optionalNumber,
  optionalString,
  optionalStrings,
  optionalUpdateLinks,
  requiredString,
} from "./input";

/**
 * Everything an agent can do on Slopper. The MCP server lists these as
 * tools and the REST API maps routes onto them, so both share one
 * implementation and one validation path with the web forms.
 */

export interface OperationContext {
  user: User;
  now: Date;
}

/** What a public operation gets: anyone may call it, with or without a token. */
export interface ViewerContext {
  user: User | null;
  now: Date;
}

/** JSON Schema for a tool's input object. */
export interface InputSchema {
  type: "object";
  properties: Record<string, JsonObject>;
  required?: string[];
}

interface OperationInfo {
  name: string;
  title: string;
  description: string;
  inputSchema: InputSchema;
  readOnly: boolean;
}

/** Needs a signed-in user (an API token). */
export interface UserOperation extends OperationInfo {
  public?: false;
  run(context: OperationContext, input: JsonObject): Promise<unknown>;
}

/** Reads what anyone can see on the site, so it works without a token too. */
export interface PublicOperation extends OperationInfo {
  public: true;
  run(context: ViewerContext, input: JsonObject): Promise<unknown>;
}

export type Operation = UserOperation | PublicOperation;

function publicOperation(operation: Omit<PublicOperation, "public">): PublicOperation {
  return { ...operation, public: true };
}

function summarizeSlop(slop: Doc<"slops">, owner: User) {
  return {
    id: slop._id,
    number: slop.number,
    slug: slop.slug,
    productId: slop.productId ?? slop._id,
    launchLabel: slop.launchLabel,
    name: slop.name,
    tagline: slop.tagline,
    /** Blurred for everyone who hasn't opted in to NSFW. */
    nsfw: slop.nsfw,
    /** Only the user can see it: it's waiting for a moderator, or a moderator took it down. */
    hidden: slop.hidden,
    url: absoluteUrl(slopPath(owner.username, slop.slug)),
    launchDate: slop.launchDate,
    /** When update_slop stops working; post_update is the way to add news after that. */
    editableUntil: new Date(
      editableUntil({ launchedAt: slop._creationTime, launchDate: slop.launchDate }),
    ).toISOString(),
    goalDay: slop.goalDay,
    upvotes: slop.upvotes,
    updates: slop.updateCount,
    fieldTests: slop.fieldTests,
    // Feedback reaches agents only when comments are on (COMMENTS_ENABLED).
    ...(config.commentsEnabled ? { feedback: slop.commentCount } : {}),
    backers: slop.backers,
    pledgedUsdCents: slop.pledged,
    slopOfTheDay: slop.slopOfTheDay,
    slopcessful: slop.slopcessfulAt
      ? { at: new Date(slop.slopcessfulAt).toISOString(), note: slop.slopcessfulNote }
      : null,
    /** The promo video: none, pending (waiting for a moderator) or live. */
    video: !slop.video ? "none" : slop.video.approvedAt === null ? "pending" : "live",
    /** Whether it has a publication (a PDF or EPUB) to read. */
    publication: slop.publication !== undefined,
  };
}

/** Days a slop's analytics can cover through the API, as on its analytics page. */
export const SLOP_ANALYTICS_DAYS = 90;

type SlopReport = FunctionReturnType<typeof api.analytics.slopReport>;

/** A slop's analytics as agents read them: totals, the change, and the top of each list. */
function summarizeReport({ slop, report, truncated, days }: SlopReport) {
  const { totals, previous, series } = report;
  const change = previous.views === 0 ? null : Math.round(((totals.views - previous.views) / previous.views) * 100);
  return {
    slop: { id: slop.id, name: slop.name, url: absoluteUrl(slopPath(slop.username, slop.slug)) },
    days,
    views: totals.views,
    people: totals.people,
    visits: totals.sessions,
    interactions: totals.interactions,
    previous: { views: previous.views, people: previous.people },
    /** Percent change in views on the period before; null when there were none before. */
    viewsChangePercent: change,
    daily: series.buckets.map((start, index) => ({
      date: new Date(start).toISOString().slice(0, 10),
      views: series.views[index] ?? 0,
      people: series.people[index] ?? 0,
    })),
    sources: report.sources.map((row) => ({ source: row.value, visits: row.count, people: row.visitors })),
    clicks: report.clicks.map((row) => ({ what: row.value, clicks: row.count, people: row.visitors })),
    actions: Object.fromEntries(
      report.actions
        .filter((action) => config.commentsEnabled || action.name !== "commented")
        .map((action) => [action.name, action.count]),
    ),
    upvotes: slop.upvotes,
    backers: slop.backers,
    pledgedUsdCents: slop.pledged,
    updates: slop.updates,
    fieldTests: slop.fieldTests,
    ...(config.commentsEnabled ? { feedback: slop.comments } : {}),
    /** True when there was more than one report reads; the numbers cover the start of the range. */
    truncated,
  };
}

/** Bytes sent as base64 (MCP has no raw bodies), with or without a data: prefix. */
function base64Bytes(input: JsonObject): Uint8Array<ArrayBuffer> {
  const base64 = requiredString(input, "base64").replace(/^data:[^,]+,/, "");
  try {
    return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  } catch {
    throw new ApiError(400, "base64 is not valid base64.");
  }
}

/** Finds one of the caller's slops by id or slug. */
async function ownSlop(context: OperationContext, ref: string): Promise<Doc<"slops">> {
  const slop = await convex.query(api.slops.findForServer, { userId: context.user._id, ref: ref.trim() });
  if (!slop) throw new ApiError(404, `No slop of yours matches “${ref}”.`);
  return slop;
}

async function slopById(slopId: Doc<"slops">["_id"]): Promise<Doc<"slops">> {
  const slop = await convex.query(api.slops.getForServer, { slopId });
  if (!slop) throw new ApiError(404, "Slop not found.");
  return slop;
}

/** Votes as agents spell them. */
const VOTE_INPUTS = { up: 1, down: -1, clear: 0 } as const satisfies Record<string, Vote>;
type VoteInput = keyof typeof VOTE_INPUTS;

function isVoteInput(value: string): value is VoteInput {
  return Object.hasOwn(VOTE_INPUTS, value);
}

function voteName(vote: Vote): "up" | "down" | null {
  return vote === 1 ? "up" : vote === -1 ? "down" : null;
}

const SLOP_REF = { type: "string", description: "The slop's id or slug (from list_my_slops or create_slop)." };

const LINKS_SCHEMA = {
  type: "array",
  description:
    "Where people can try it. At least one, unless the slop has a publication to read. Store links must use their store's domain.",
  items: {
    type: "object",
    properties: { kind: { type: "string", enum: Object.keys(LINK_KINDS) }, url: { type: "string" } },
    required: ["kind", "url"],
  },
  maxItems: LIMITS.links,
};

const SCHEDULED_REF = {
  type: "string",
  description: "The scheduled launch's id (from list_scheduled or create_slop).",
};

const RELEASE_AT = {
  type: "string",
  description:
    "Schedule it instead of launching now. “next”: the next day with nothing out or scheduled, at midnight UTC as that day's race starts (all 24 hours of votes). Or an ISO 8601 date-time within 100 days: with an offset, or without one for the user's own time zone. It counts towards the goal on the UTC day it goes out.",
};

type ScheduledItem = FunctionReturnType<typeof api.schedule.mine>[number];

function summarizeScheduled(item: ScheduledItem, user: User) {
  return {
    id: item.id,
    name: item.name,
    launchLabel: item.launchLabel,
    releaseAt: new Date(item.releaseAt).toISOString(),
    /** In the user's time zone. */
    releaseAtLocal: formatRelease(item.releaseAt, user.timeZone),
    autopost: item.autopost,
    /** Out but not checked and auto-posted yet: release_scheduled finishes it. */
    out: item.out ? absoluteUrl(slopPath(user.username, item.out.slug)) : null,
  };
}

/** A publication to read, for create_slop and update_slop. */
const PUBLICATION_SCHEMA = {
  type: "string",
  description:
    "An id from upload_publication: a PDF or EPUB the user wrote, read from the slop page. With one, links are optional. On update_slop, null takes it off.",
};

/** The product page fields, shared by create_slop and update_slop. */
const PRODUCT_PAGE_SCHEMA = {
  demo: {
    type: "string",
    description:
      "A demo video linked on YouTube (videos or Shorts), Loom or Vimeo, shown beside the name. Uploaded promo videos go through set_video. An empty string removes it.",
  },
  features: {
    type: "array",
    description: "What it does, shown on its page. Replaces the whole list; [] removes them.",
    items: {
      type: "object",
      properties: {
        title: { type: "string", maxLength: LIMITS.featureTitleLength },
        body: { type: "string", maxLength: LIMITS.featureBodyLength, description: "One line." },
      },
      required: ["title"],
    },
    maxItems: LIMITS.features,
  },
  audience: { type: "string", maxLength: LIMITS.audienceLength, description: "Who it's for, in one line." },
};

const AUTOPOST = {
  type: "boolean",
  description: `Post it to the user's connected ${listWords(autopostNetworks(), "and")} accounts. Defaults to false. When it can't be posted yet (it's waiting for a moderator, marked NSFW or flagged), the result says why.`,
};

/** A slop's reviews by its id, or by slug for the user's own. */
async function reviewsOf(context: ViewerContext, ref: string) {
  const own = context.user
    ? await convex.query(api.slops.findForServer, { userId: context.user._id, ref: ref.trim() })
    : null;
  const listed = await convex.query(api.reviews.listForServer, { slopId: own?._id ?? ref.trim() });
  if (!listed) throw new ApiError(404, "Slop not found.");
  return listed;
}

type SocialPostShape = NonNullable<FunctionReturnType<typeof api.social.get>>;

function shapeSocialPost(post: Omit<SocialPostShape, "editable"> & { editable?: boolean }) {
  return {
    id: post.id,
    url: absoluteUrl(`/studio/posts/${post.id}`),
    text: post.text,
    status: post.draft
      ? "draft"
      : post.cancelled
        ? "cancelled"
        : post.scheduledAt !== null && !post.released
          ? "scheduled"
          : "sent",
    scheduledAt: post.scheduledAt === null ? null : new Date(post.scheduledAt).toISOString(),
    tags: post.tags,
    editable: post.editable ?? null,
    link: post.link,
    thread: post.thread,
    firstComment: post.firstComment,
    perNetwork: post.overrides,
    options: post.options,
    media: post.media.map(({ id, kind, alt, duration, width, height, coverAt }) => ({
      id,
      kind,
      alt,
      duration,
      width,
      height,
      coverAt,
    })),
    copies: post.deliveries.map((row) => ({
      accountId: row.accountId,
      network: row.provider,
      account: row.handle,
      status: row.status,
      repost: row.repost,
      url: row.url,
      message: row.message ?? row.warning,
      stats: row.metrics,
    })),
    clicks: post.links.reduce((total, row) => total + row.clicks, 0),
  };
}

/** Validate each network's complete settings before the composer reads them. */
function networkOptions(value: unknown, previous: NetworkOptions): NetworkOptions {
  const changes = asObject(value, "options");
  const next: NetworkOptions = { ...previous };
  const bool = (obj: JsonObject, key: string): boolean => {
    const result = optionalBoolean(obj, key);
    if (result === undefined) throw new ApiError(400, `options.${key} must be true or false.`);
    return result;
  };
  for (const [network, raw] of Object.entries(changes)) {
    if (
      raw === null &&
      (network === "youtube" || network === "tiktok" || network === "instagram" || network === "linkedin")
    ) {
      delete next[network];
      continue;
    }
    const fields = asObject(raw, `options.${network}`);
    if (network === "youtube") {
      const privacy = requiredString(fields, "privacy");
      if (!YOUTUBE_PRIVACY.some((value) => value === privacy)) throw new ApiError(400, "Invalid YouTube privacy.");
      next.youtube = {
        title: optionalString(fields, "title") ?? "",
        privacy: privacy as NonNullable<NetworkOptions["youtube"]>["privacy"],
        madeForKids: bool(fields, "madeForKids"),
      };
    } else if (network === "tiktok") {
      const privacy = optionalString(fields, "privacy") ?? null;
      if (privacy !== null && !TIKTOK_PRIVACY.some((value) => value === privacy))
        throw new ApiError(400, "Invalid TikTok privacy.");
      next.tiktok = {
        privacy: privacy as NonNullable<NetworkOptions["tiktok"]>["privacy"],
        allowComments: bool(fields, "allowComments"),
        allowDuet: bool(fields, "allowDuet"),
        allowStitch: bool(fields, "allowStitch"),
        brandedContent: bool(fields, "brandedContent"),
        yourBrand: bool(fields, "yourBrand"),
      };
    } else if (network === "instagram") {
      const format = requiredString(fields, "format");
      if (!INSTAGRAM_FORMATS.some((value) => value === format)) throw new ApiError(400, "Invalid Instagram format.");
      next.instagram = {
        format: format as NonNullable<NetworkOptions["instagram"]>["format"],
        collaborators: optionalStrings(fields, "collaborators"),
      };
    } else if (network === "linkedin") {
      next.linkedin = { documentTitle: optionalString(fields, "documentTitle") ?? "" };
    } else throw new ApiError(400, `Unknown network options: ${network}.`);
  }
  return next;
}

async function socialPostSummary(user: User, postId: string) {
  const [post, accounts] = await Promise.all([
    convex.query(api.social.get, { userId: user._id, postId }),
    convex.query(api.accounts.list, { userId: user._id }),
  ]);
  if (!post) throw new ApiError(404, "No such post.");
  const video = post.media.find((item) => item.kind === "video");
  const shape = {
    images: post.media.filter((item) => item.kind === "image").length,
    video: video ? (video.duration ?? 0) : null,
    documents: post.media.filter((item) => item.kind === "document").length,
  };
  const context = { timeZone: user.timeZone, product: post.product?.name ?? null };
  const copies = post.deliveries.map((row) => {
    const account = accounts.find((entry) => entry._id === row.accountId);
    const warnings: string[] = [];
    if (!account) warnings.push("Account is no longer available; reconnect or remove it.");
    if (account?.broken) warnings.push(`Reconnect this account: ${account.broken}`);
    if (!row.repost) {
      const reason = unsupportedReason(row.provider, shape);
      if (reason) warnings.push(reason);
      warnings.push(...optionProblems(new Set([row.provider]), post.options));
      const raw = post.overrides[row.accountId]?.trim() || post.overrides[row.provider]?.trim() || post.text;
      const at = post.scheduledAt ?? Date.now();
      const expanded = personalize(raw, row.accountId, {
        at,
        ...context,
        link: post.link,
        network: NETWORK_LABELS[row.provider],
      });
      const suffix =
        post.link && row.provider !== "instagram" && row.provider !== "tiktok" && !expanded.includes(post.link)
          ? `\n\n${post.link}`
          : "";
      if (measureFor(row.provider)(expanded.trim() + suffix) > textLimitFor(row.provider, account)) {
        warnings.push("This copy exceeds the account's character limit and will be shortened. Edit it before sending.");
      }
    }
    return {
      accountId: row.accountId,
      text: row.repost
        ? null
        : wordsFor(row.provider, post, {
            account: { _id: row.accountId, longPosts: account?.longPosts },
            context,
            at: post.scheduledAt ?? Date.now(),
          }),
      warnings,
    };
  });
  return {
    ...shapeSocialPost(post),
    readiness: {
      note: "Preflight guidance only: the content check and network acceptance happen when scheduling or sending.",
      copies,
    },
  };
}

export const OPERATIONS: Operation[] = [
  {
    name: "whoami",
    title: "Who am I",
    description:
      "The signed-in Slopper user: profile, time zone, the open goal with progress, streak and votes left today. Call this first.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ user, now }) {
      const [profile, votesLeft] = await Promise.all([
        convex.query(api.users.profile, { username: user.username, asUser: user._id }),
        convex.query(api.slops.votesLeft, { asUser: user._id }),
      ]);
      const progress = profile?.progress ?? null;
      return {
        username: user.username,
        displayName: user.displayName,
        profileUrl: absoluteUrl(`/@${user.username}`),
        timeZone: user.timeZone,
        /** Days are UTC days, for everyone. */
        today: utcDate(now),
        streak: profile?.streak ?? 0,
        totalSlops: profile?.totalShipped ?? 0,
        votesLeft,
        goal: progress
          ? {
              title: progress.goal.title,
              target: progress.goal.target,
              days: progress.goal.days,
              startDate: progress.goal.startDate,
              endDate: progress.endDate,
              shipped: progress.shipped,
              currentDay: progress.currentDay,
              status: progress.status,
            }
          : null,
      };
    },
  },
  publicOperation({
    name: "get_profile",
    title: "Look up a profile",
    description:
      "Anyone's public profile by username: their streak, slops, votes and days won, the open goal day by day (shipped, missed, today, upcoming and how many are scheduled) and past goals. The same as their page on the site.",
    inputSchema: {
      type: "object",
      properties: {
        username: { type: "string", description: "Their username, with or without the @." },
      },
      required: ["username"],
    },
    readOnly: true,
    async run({ user }, input) {
      const username = requiredString(input, "username").trim().replace(/^@/, "");
      const profile = await convex.query(api.users.profile, { username, asUser: user?._id });
      if (!profile) throw new ApiError(404, `Nobody is called @${username}.`);
      const { owner, progress } = profile;
      const slopUrl = (slug: string) => absoluteUrl(slopPath(owner.username, slug));
      return {
        username: owner.username,
        displayName: owner.displayName,
        bio: owner.bio,
        profileUrl: absoluteUrl(`/@${owner.username}`),
        today: profile.today,
        streak: profile.streak,
        totalSlops: profile.totalShipped,
        upvotes: profile.upvotes,
        daysWon: profile.daysWon,
        goal: progress
          ? {
              title: progress.goal.title,
              target: progress.goal.target,
              days: progress.goal.days,
              startDate: progress.goal.startDate,
              endDate: progress.endDate,
              shipped: progress.shipped,
              /** Still to ship to hit the target. */
              toGo: Math.max(0, progress.goal.target - progress.shipped),
              currentDay: progress.currentDay,
              status: progress.status,
              board: progress.days.map((day) => ({
                day: day.day,
                date: day.date,
                state: day.state,
                slops: day.launches.map((launch) => ({ name: launch.name, url: slopUrl(launch.slug) })),
                scheduled: day.queued,
              })),
            }
          : null,
        pastGoals: profile.pastGoals.map(({ title, shipped, target, status }) => ({ title, shipped, target, status })),
        slops: profile.items.map((item) => ({
          id: item.slop.id,
          name: item.slop.name,
          launchLabel: item.slop.launchLabel,
          tagline: item.slop.tagline,
          category: item.slop.category,
          nsfw: item.slop.nsfw,
          upvotes: item.slop.upvotes,
          launchDate: item.slop.launchDate,
          url: slopUrl(item.slop.slug),
        })),
      };
    },
  }),
  publicOperation({
    name: "list_tags",
    title: "List made-with tags",
    description:
      "Tags for a slop's madeWith, most used first, each with its kind: the model (Opus 5.5), the harness that ran it (Claude Code), the framework or the platform. Use these spellings; anything else becomes a new tag.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run() {
      const counted = await convex.query(api.tags.popular, {});
      return {
        kinds: TAG_KINDS.map(({ id, label }) => ({ id, label })),
        tags: tagOptions(counted).map(({ name, kind, uses }) => ({ name, kind, uses })),
      };
    },
  }),
  publicOperation({
    name: "list_categories",
    title: "List categories and link kinds",
    description: "Valid values for a slop's category, link kinds, currencies and money categories.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    run() {
      return Promise.resolve({
        categories: CATEGORIES.map(({ id, label }) => ({ id, label })),
        linkKinds: Object.entries(LINK_KINDS).map(([kind, info]) => ({
          kind,
          label: info.label,
          beta: info.beta,
          hosts: "hosts" in info ? info.hosts : null,
        })),
        currencies: CURRENCIES,
        costCategories: COST_CATEGORIES,
        revenueCategories: REVENUE_CATEGORIES,
      });
    },
  }),
  {
    name: "set_goal",
    title: "Set a goal",
    description:
      "Start a goal such as 30 slops in 30 days. Only one goal can be open; days are UTC days, ending at midnight UTC.",
    inputSchema: {
      type: "object",
      properties: {
        target: { type: "integer", minimum: 1, maximum: 1000, description: "How many slops to ship." },
        days: { type: "integer", minimum: 1, maximum: LIMITS.goalDays, description: "How many days." },
        startDate: { type: "string", format: "date", description: "YYYY-MM-DD, today or later. Defaults to today." },
        title: { type: "string", maxLength: 80, description: "Defaults to “N slops in M days”." },
      },
      required: ["target", "days"],
    },
    readOnly: false,
    async run({ user, now }, input) {
      const today = utcDate(now);
      const parsed = validateGoal(
        {
          target: optionalNumber(input, "target"),
          days: optionalNumber(input, "days"),
          startDate: optionalString(input, "startDate"),
          title: optionalString(input, "title"),
        },
        today,
      );
      if (!parsed.ok) throw new ApiError(422, "The goal needs fixing.", parsed.errors);
      const result = await convex.mutation(api.goals.create, { userId: user._id, today, ...parsed.value });
      if (!result.ok) throw new ApiError(409, result.error);
      const { title, target, days, startDate, endDate } = result.goal;
      return { goal: { title, target, days, startDate, endDate }, profileUrl: absoluteUrl(`/@${user.username}`) };
    },
  },
  {
    name: "upload_screenshot",
    title: "Upload a screenshot",
    description: `Upload a PNG, JPEG, WebP or GIF (max ${LIMITS.mediaBytes / 1024 / 1024} MB) as base64. Explicit or hateful images are refused. Returns an id to pass in create_slop or update_slop screenshots or post_update images, and nsfw: true when the image will blur any slop that shows it.`,
    inputSchema: {
      type: "object",
      properties: { base64: { type: "string", description: "Image bytes, base64 encoded (no data: prefix)." } },
      required: ["base64"],
    },
    readOnly: false,
    async run({ user }, input) {
      const result = await uploadImage(user._id, { bytes: base64Bytes(input) });
      if (!result.ok) throw new ApiError(400, result.error);
      return { id: result.id, url: result.url, nsfw: result.contentCheck === "mature" };
    },
  },
  {
    name: "upload_video",
    title: "Upload a promo video",
    description: `Upload an MP4 or WebM (max ${LIMITS.videoBytes / 1024 / 1024} MB) as base64, for set_video.`,
    inputSchema: {
      type: "object",
      properties: { base64: { type: "string", description: "Video bytes, base64 encoded (no data: prefix)." } },
      required: ["base64"],
    },
    readOnly: false,
    async run({ user }, input) {
      const result = await uploadVideo(user._id, base64Bytes(input));
      if (!result.ok) throw new ApiError(400, result.error);
      return { id: result.id };
    },
  },
  {
    name: "upload_publication",
    title: "Upload a publication",
    description: `Upload a PDF or EPUB the user wrote (a book, zine, guide or paper; max ${LIMITS.publicationBytes / 1024 / 1024} MB) as base64. Explicit or hateful ones are refused, and so are files with scripts, forms, attachments, DRM or things loaded from the web. Returns an id to pass as publication in create_slop or update_slop, and nsfw: true when it will blur the slop that shows it.`,
    inputSchema: {
      type: "object",
      properties: {
        base64: { type: "string", description: "PDF or EPUB bytes, base64 encoded (no data: prefix)." },
        fileName: {
          type: "string",
          maxLength: LIMITS.publicationNameLength,
          description: "The name it's shown by on the slop, like “field-guide.pdf” or “zine.epub”.",
        },
      },
      required: ["base64"],
    },
    readOnly: false,
    async run({ user }, input) {
      const result = await uploadPublication(user._id, {
        bytes: base64Bytes(input),
        fileName: optionalString(input, "fileName"),
      });
      if (!result.ok) throw new ApiError(400, result.error);
      const { id, url, fileName, format } = result;
      return { id, url, fileName, format, nsfw: result.contentCheck === "mature" };
    },
  },
  {
    name: "set_video",
    title: "Set a slop's promo video",
    description:
      "Put a video from upload_video on one of your slops, replacing its last one, or pass null to take it off. video is pending while it waits for a moderator, then live. Once one of the user's videos has been approved, later ones can be live straight away.",
    inputSchema: {
      type: "object",
      properties: {
        slop: SLOP_REF,
        video: { type: ["string", "null"], description: "An id from upload_video, or null to remove the video." },
      },
      required: ["slop", "video"],
    },
    readOnly: false,
    async run(context, input) {
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const video = input.video;
      if (video !== null && typeof video !== "string") {
        throw new ApiError(400, "video must be an id from upload_video, or null to remove it.");
      }
      const result = await convex.mutation(api.videos.set, {
        userId: context.user._id,
        slopId: slop._id,
        mediaId: video,
      });
      if (result.orphaned > 0) await deleteOrphanedMedia();
      if (result.check) await checkVideo(slop._id, result.check);
      return { slop: summarizeSlop(await slopById(slop._id), context.user) };
    },
  },
  {
    name: "create_slop",
    title: "Launch a slop",
    description:
      "Throw a new slop at the wall. It counts towards today's goal and enters today's slop of the day race. To launch an existing product again (new platform, new app, 2.0), pass relaunchOf and launchLabel. With releaseAt it's scheduled instead: nobody sees it until it goes out, then it counts and races like any launch.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", maxLength: LIMITS.nameLength },
        tagline: { type: "string", maxLength: LIMITS.taglineLength, description: "One line: what does it do?" },
        description: { type: "string", maxLength: LIMITS.descriptionLength, description: "Markdown." },
        category: { type: "string", enum: CATEGORIES.map((category) => category.id) },
        links: LINKS_SCHEMA,
        screenshots: {
          type: "array",
          items: { type: "string" },
          maxItems: LIMITS.screenshots,
          description: "Ids from upload_screenshot; the first is the cover.",
        },
        publication: PUBLICATION_SCHEMA,
        madeWith: {
          type: "array",
          items: { type: "string" },
          maxItems: LIMITS.madeWith,
          description: "The model, the harness and what it's built on, spelled as list_tags has them.",
        },
        ...PRODUCT_PAGE_SCHEMA,
        launchNote: {
          type: "string",
          maxLength: LIMITS.updateLength,
          description: "First update; also the auto-post text.",
        },
        relaunchOf: {
          type: "string",
          description:
            "To launch an existing product again, the id or slug of an earlier launch. Features are updates, not launches.",
        },
        launchLabel: {
          type: "string",
          maxLength: LIMITS.launchLabelLength,
          description: "Required with relaunchOf: what's launching, e.g. “iOS app” or “2.0”.",
        },
        releaseAt: RELEASE_AT,
        autopost: AUTOPOST,
      },
      required: ["name", "tagline", "category"],
    },
    readOnly: false,
    async run(context, input) {
      const { user, now } = context;
      const parsed = validateSlop({
        name: optionalString(input, "name"),
        tagline: optionalString(input, "tagline"),
        description: optionalString(input, "description"),
        category: optionalString(input, "category"),
        links: optionalLinks(input, "links"),
        screenshots: optionalStrings(input, "screenshots"),
        publication: optionalString(input, "publication"),
        madeWith: optionalStrings(input, "madeWith"),
        demo: optionalString(input, "demo"),
        features: optionalFeatures(input, "features"),
        audience: optionalString(input, "audience"),
        launchNote: optionalString(input, "launchNote"),
      });
      if (!parsed.ok) throw new ApiError(422, "The slop needs fixing.", parsed.errors);
      const relaunchRef = optionalString(input, "relaunchOf");
      const source = relaunchRef ? await ownSlop(context, relaunchRef) : null;
      const label = optionalString(input, "launchLabel")?.trim() ?? "";
      if (source && (!label || label.length > LIMITS.launchLabelLength)) {
        throw new ApiError(
          422,
          `launchLabel is required with relaunchOf (1 to ${LIMITS.launchLabelLength} characters).`,
        );
      }
      const releaseText = optionalString(input, "releaseAt");
      const release = releaseText === undefined ? { kind: "now" as const } : parseRelease(releaseText, user.timeZone);
      if (!release) {
        throw new ApiError(422, "releaseAt must be “next” or an ISO 8601 date-time, like 2026-10-15T09:00.");
      }
      if (release.kind === "at") {
        const problem = releaseProblem(release.at, now.getTime());
        if (problem) throw new ApiError(422, `releaseAt: ${problem}`);
      }
      const { launchNote, ...fields } = parsed.value;
      const autopost = optionalBoolean(input, "autopost") ?? false;
      const relaunch = source ? { relaunchOf: source._id, launchLabel: label } : {};
      if (release.kind !== "now") {
        const queued = await convex.mutation(api.schedule.add, {
          userId: user._id,
          input: fields,
          launchNote: launchNote || fields.tagline,
          when: release,
          autopost,
          ...relaunch,
        });
        const queue = await convex.query(api.schedule.mine, { asUser: user._id });
        const item = queue.find((entry) => entry.id === queued.id);
        if (!item) throw new Error(`Scheduled launch ${queued.id} isn't in the queue.`);
        return { scheduled: summarizeScheduled(item, user) };
      }
      const created = await convex.mutation(api.slops.create, {
        userId: user._id,
        input: fields,
        launchNote: launchNote || fields.tagline,
        ...relaunch,
      });
      const finished = await finishLaunch(user, created, autopost);
      return {
        slop: summarizeSlop(await slopById(created.slopId), user),
        autopost: finished.autopost,
      };
    },
  },
  {
    name: "update_slop",
    title: "Edit a slop",
    description:
      "Change a slop's details. Only the fields you pass change; the slug and launch date stay put. Editing closes at the slop's editableUntil (the end of its launch day, or 12 hours after launch if that's later); after that, post_update is the way to share what's new.",
    inputSchema: {
      type: "object",
      properties: {
        slop: SLOP_REF,
        name: { type: "string" },
        tagline: { type: "string" },
        description: { type: "string" },
        category: { type: "string", enum: CATEGORIES.map((category) => category.id) },
        links: LINKS_SCHEMA,
        screenshots: { type: "array", items: { type: "string" } },
        publication: { ...PUBLICATION_SCHEMA, type: ["string", "null"] },
        madeWith: { type: "array", items: { type: "string" } },
        ...PRODUCT_PAGE_SCHEMA,
      },
      required: ["slop"],
    },
    readOnly: false,
    async run(context, input) {
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const parsed = validateSlop({
        name: optionalString(input, "name") ?? slop.name,
        tagline: optionalString(input, "tagline") ?? slop.tagline,
        description: optionalString(input, "description") ?? slop.description,
        category: optionalString(input, "category") ?? slop.category,
        links: optionalLinks(input, "links") ?? slop.links,
        screenshots: optionalStrings(input, "screenshots") ?? slop.screenshots,
        // null takes it off; left out, it stays.
        publication: input.publication === null ? null : (optionalString(input, "publication") ?? slop.publication),
        madeWith: optionalStrings(input, "madeWith") ?? slop.madeWith,
        demo: optionalString(input, "demo") ?? (slop.demo ? videoPageUrl(slop.demo) : ""),
        features: optionalFeatures(input, "features") ?? slop.features ?? [],
        audience: optionalString(input, "audience") ?? slop.audience ?? "",
      });
      if (!parsed.ok) throw new ApiError(422, "The slop needs fixing.", parsed.errors);
      const { launchNote: _launchNote, ...fields } = parsed.value;
      const edited = await convex.mutation(api.slops.edit, {
        userId: context.user._id,
        slopId: slop._id,
        input: fields,
      });
      if (edited.orphaned > 0) await deleteOrphanedMedia();
      const saved = await slopById(slop._id);
      if (checkedContent(saved) !== checkedContent(slop)) await checkSlop(slop._id);
      return { slop: summarizeSlop(await slopById(slop._id), context.user) };
    },
  },
  {
    name: "post_update",
    title: "Post an update",
    description:
      "Add to a slop's updates. Kinds: update (fixes, news), feature (something new shipped), field (a real-world test: who tried it and what they said), repromote (bump it back up). It can carry the version that shipped, images from upload_screenshot, and links, each with an optional preview card.",
    inputSchema: {
      type: "object",
      properties: {
        slop: SLOP_REF,
        kind: { type: "string", enum: [...POSTABLE_UPDATE_KINDS] },
        body: { type: "string", maxLength: LIMITS.updateLength, description: "Markdown." },
        version: {
          type: "string",
          maxLength: LIMITS.versionLength,
          description: "What shipped, like v1.3 or 2.0 beta.",
        },
        images: {
          type: "array",
          items: { type: "string" },
          maxItems: LIMITS.updateImages,
          description: "Media ids from upload_screenshot, in order.",
        },
        links: {
          type: "array",
          maxItems: LIMITS.updateLinks,
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: Object.keys(LINK_KINDS), description: "Defaults to website." },
              url: { type: "string" },
              preview: {
                type: "boolean",
                description:
                  "Show a card with the page's title, description and image. Off by default; only ask for one when the user wants it.",
              },
            },
            required: ["url"],
          },
        },
        featureName: {
          type: "string",
          maxLength: LIMITS.featureNameLength,
          description: "For a feature: what it's called, like Level editor.",
        },
        outcome: {
          type: "string",
          enum: Object.keys(FIELD_OUTCOMES),
          description: "For a field test: how it went.",
        },
        who: {
          type: "string",
          maxLength: LIMITS.fieldWhoLength,
          description: "For a field test (with outcome): who tried it, like 5 people at the bus stop.",
        },
        autopost: AUTOPOST,
      },
      required: ["slop", "kind", "body"],
    },
    readOnly: false,
    async run(context, input) {
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const parsed = validateUpdate({
        kind: requiredString(input, "kind"),
        body: requiredString(input, "body"),
        version: optionalString(input, "version"),
        images: optionalStrings(input, "images"),
        links: optionalUpdateLinks(input, "links"),
        featureName: optionalString(input, "featureName"),
        outcome: optionalString(input, "outcome"),
        who: optionalString(input, "who"),
      });
      if (!parsed.ok) throw new ApiError(422, "The update needs fixing.", parsed.errors);
      const { updateId, missedPreviews } = await postUpdate(context.user._id, slop._id, parsed.value);
      const autopost = optionalBoolean(input, "autopost") ? await announce(context.user, slop._id, updateId) : null;
      return {
        update: {
          id: updateId,
          kind: parsed.value.kind,
          url: `${absoluteUrl(slopPath(context.user.username, slop.slug))}#update-${updateId}`,
          ...(missedPreviews > 0 ? { missedPreviews } : {}),
        },
        autopost,
      };
    },
  },
  {
    name: "log_money",
    title: "Log a cost or revenue",
    description:
      "Record money for a product (shared by all its launches): a cost like a domain, hosting or AI tokens, or revenue like sales or subscriptions.",
    inputSchema: {
      type: "object",
      properties: {
        slop: SLOP_REF,
        kind: { type: "string", enum: ["cost", "revenue"] },
        amount: { type: "number", exclusiveMinimum: 0, description: "In major units, e.g. 12.99." },
        currency: { type: "string", enum: [...CURRENCIES], description: "Defaults to USD." },
        category: {
          type: "string",
          description: `Cost: ${COST_CATEGORIES.join(", ")}. Revenue: ${REVENUE_CATEGORIES.join(", ")}.`,
        },
        note: { type: "string", maxLength: LIMITS.ledgerNoteLength },
        date: { type: "string", format: "date", description: "YYYY-MM-DD. Defaults to today." },
      },
      required: ["slop", "kind", "amount"],
    },
    readOnly: false,
    async run(context, input) {
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const kind = requiredString(input, "kind");
      if (kind !== "cost" && kind !== "revenue") throw new ApiError(400, "kind must be cost or revenue.");
      const major = optionalNumber(input, "amount") ?? 0;
      const amount = Math.round(major * 100);
      const currency = optionalString(input, "currency") ?? "USD";
      const categories: readonly string[] = kind === "cost" ? COST_CATEGORIES : REVENUE_CATEGORIES;
      const category = optionalString(input, "category") ?? "other";
      const note = (optionalString(input, "note") ?? "").trim();
      const date = optionalString(input, "date") ?? localDate(context.now, context.user.timeZone);
      if (!Number.isFinite(amount) || amount <= 0 || amount > 1e12) {
        throw new ApiError(422, "amount must be above zero.");
      }
      if (!(CURRENCIES as readonly string[]).includes(currency))
        throw new ApiError(422, `currency is one of ${CURRENCIES.join(", ")}.`);
      if (!categories.includes(category)) throw new ApiError(422, `category is one of ${categories.join(", ")}.`);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new ApiError(422, "date must be YYYY-MM-DD.");
      if (note.length > LIMITS.ledgerNoteLength)
        throw new ApiError(422, `note is over ${LIMITS.ledgerNoteLength} characters.`);
      const entryId = await convex.mutation(api.money.add, {
        userId: context.user._id,
        slopId: slop._id,
        kind,
        amount,
        currency,
        category,
        note,
        date,
      });
      return { entry: { id: entryId, kind, amount: major, currency, category, note, date } };
    },
  },
  {
    name: "list_my_slops",
    title: "List my slops",
    description: "Every slop the user has launched, newest first, with votes, updates, pledges and badges.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ user }) {
      const slops = await convex.query(api.slops.listForServer, { userId: user._id });
      return { slops: slops.map((slop) => summarizeSlop(slop, user)) };
    },
  },
  {
    name: "slop_analytics",
    title: "A slop's views and clicks",
    description: `How one of the user's slops is doing: page views and the people behind them over the last \`days\` (30 unless given, up to ${SLOP_ANALYTICS_DAYS}) against the days before, day by day; where visitors came from; what they clicked on its page; and its votes, pledges and updates. The user's own visits don't count.`,
    inputSchema: {
      type: "object",
      properties: {
        slop: SLOP_REF,
        days: { type: "integer", minimum: 1, maximum: SLOP_ANALYTICS_DAYS, description: "Defaults to 30." },
      },
      required: ["slop"],
    },
    readOnly: true,
    async run(context, input) {
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const days = optionalNumber(input, "days") ?? 30;
      if (!Number.isInteger(days) || days < 1 || days > SLOP_ANALYTICS_DAYS) {
        throw new ApiError(400, `days must be a whole number from 1 to ${SLOP_ANALYTICS_DAYS}.`);
      }
      return summarizeReport(
        await convex.action(api.analytics.slopReport, { userId: context.user._id, slopId: slop._id, days }),
      );
    },
  },
  {
    name: "list_scheduled",
    title: "List scheduled launches",
    description:
      "Launches waiting to go out, soonest first. Only the user sees them until they go out. One marked `out` has gone out but isn't finished yet: release_scheduled finishes it.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ user }) {
      const queue = await convex.query(api.schedule.mine, { asUser: user._id });
      return { scheduled: queue.map((item) => summarizeScheduled(item, user)) };
    },
  },
  {
    name: "release_scheduled",
    title: "Launch a scheduled slop now",
    description:
      "Put a scheduled launch out now instead of at its time: it counts towards today's goal and enters today's race.",
    inputSchema: { type: "object", properties: { scheduled: SCHEDULED_REF }, required: ["scheduled"] },
    readOnly: false,
    async run({ user }, input) {
      const out = await releaseScheduled(user, requiredString(input, "scheduled").trim());
      return {
        slop: summarizeSlop(await slopById(out.slopId), user),
        autopost: out.finished.autopost,
      };
    },
  },
  {
    name: "cancel_scheduled",
    title: "Unschedule a launch",
    description: "Drop a scheduled launch before it goes out. Nothing is posted.",
    inputSchema: { type: "object", properties: { scheduled: SCHEDULED_REF }, required: ["scheduled"] },
    readOnly: false,
    async run({ user }, input) {
      const cancelled = await convex.mutation(api.schedule.cancel, {
        userId: user._id,
        id: requiredString(input, "scheduled").trim(),
      });
      if (cancelled.orphaned > 0) await deleteOrphanedMedia();
      return { cancelled: cancelled.name };
    },
  },
  {
    name: "list_social_accounts",
    title: "List connected social accounts",
    description:
      "The social accounts the user connected to post as (X, LinkedIn, Bluesky, Threads, Facebook Pages, Instagram, TikTok, YouTube), with the brand each speaks for. Use their ids with create_social_post.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ user }) {
      const accounts = await convex.query(api.accounts.list, { userId: user._id });
      return {
        accounts: accounts.map((account) => ({
          id: account._id,
          network: account.provider,
          networkName: NETWORK_LABELS[account.provider],
          handle: account.handle,
          name: account.displayName,
          brand: account.brand ?? null,
          needsReconnecting: account.broken ?? null,
        })),
      };
    },
  },
  {
    name: "create_social_post",
    title: "Post to social accounts",
    description:
      "Write one social post and send it as several connected accounts at once, each copy fitted to its network, or schedule it, queue it at the user's next free queue time, or save it as a draft. Everything public is checked first, like posts written in the studio. Pass the same idempotencyKey again and you get the same post back instead of a second one. Words may use {spintax|variations} and the variables {date} {day} {time} {product} {link} {network}.",
    inputSchema: {
      type: "object",
      properties: {
        accounts: { type: "array", items: { type: "string" }, description: "Account ids from list_social_accounts." },
        text: { type: "string", description: "The post. Each network gets it cut to fit, link last." },
        link: { type: "string" },
        media: { type: "array", items: { type: "string" }, description: "Uploaded picture ids (upload_screenshot)." },
        thread: {
          type: "array",
          items: { type: "string" },
          description: "Posts that follow as a thread on X, Bluesky and Threads.",
        },
        firstComment: { type: "string", description: "Posted under it where the network takes comments." },
        perNetwork: {
          type: "object",
          description:
            "Other words for one network, by network name (x, linkedin, bluesky, threads, facebook, instagram).",
        },
        at: {
          type: "string",
          description:
            "When it goes out: “now” (the default), “queue” for the next free queue time, “draft” to save it, or a date-time like 2026-11-24T09:30 (the user's time zone unless it has an offset).",
        },
        tags: { type: "array", items: { type: "string" } },
        trackLinks: {
          type: "boolean",
          description: "Send the link as a per-network short link with UTM tags, counting clicks.",
        },
        idempotencyKey: { type: "string" },
      },
      required: ["accounts", "text"],
    },
    readOnly: false,
    async run({ user }, input) {
      const at = optionalString(input, "at")?.trim() || "now";
      const special = at === "now" || at === "queue" || at === "draft";
      const scheduledAt = special ? null : wallTime(at, user.timeZone);
      if (!special && scheduledAt === null)
        throw new ApiError(400, "at must be now, queue, draft or a date-time like 2026-11-24T09:30.");
      const perNetwork = input.perNetwork;
      const overrides: Record<string, string> = {};
      if (perNetwork && typeof perNetwork === "object" && !Array.isArray(perNetwork)) {
        for (const [network, words] of Object.entries(perNetwork))
          if (typeof words === "string") overrides[network] = words;
      }
      const result = await saveStudioPost(user, {
        text: requiredString(input, "text"),
        link: optionalString(input, "link") ?? "",
        productId: null,
        accountIds: optionalStrings(input, "accounts") ?? [],
        media: (optionalStrings(input, "media") ?? []).map((id) => ({ id })),
        frames: [],
        overrides,
        options: {},
        scheduledAt,
        queue: at === "queue",
        draft: at === "draft",
        thread: optionalStrings(input, "thread") ?? [],
        firstComment: optionalString(input, "firstComment") ?? "",
        tags: optionalStrings(input, "tags") ?? [],
        trackLinks: optionalBoolean(input, "trackLinks") ?? false,
        idempotencyKey: optionalString(input, "idempotencyKey"),
        source: "api",
      });
      if (!result.ok) throw new ApiError(400, result.error);
      return await socialPostSummary(user, result.postId);
    },
  },
  {
    name: "list_social_posts",
    title: "List social posts",
    description:
      "The user's studio posts, newest first: drafts, scheduled and sent, with each account's status and stats.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ user }) {
      const posts = await convex.query(api.social.list, { userId: user._id, limit: 30 });
      return { posts: posts.map((post) => shapeSocialPost(post)) };
    },
  },
  {
    name: "get_social_post",
    title: "Get a social post",
    description: "One studio post: where each copy went, its link, and the latest likes, comments, shares and views.",
    inputSchema: { type: "object", properties: { post: { type: "string" } }, required: ["post"] },
    readOnly: true,
    async run({ user }, input) {
      return await socialPostSummary(user, requiredString(input, "post"));
    },
  },
  {
    name: "edit_social_post",
    title: "Edit or schedule a social draft",
    description:
      "Change a draft or an unsent scheduled post. Only supplied fields change. Omit at to keep its current state; use draft, queue, or a future date-time to choose when all selected accounts post. Use now only when asked to post immediately. Scheduling runs the content check first. Times without an offset use the user's time zone.",
    inputSchema: {
      type: "object",
      properties: {
        post: { type: "string", description: "Post id from list_social_posts." },
        text: { type: "string" },
        link: { type: "string", description: "Set to an empty string to clear." },
        accounts: {
          type: "array",
          items: { type: "string" },
          description: "Replace posting account ids; omit to keep them.",
        },
        repostAccounts: { type: "array", items: { type: "string" }, description: "Replace repost account ids." },
        thread: { type: "array", items: { type: "string" } },
        firstComment: { type: "string" },
        perNetwork: { type: "object", description: "Replace all network and account text overrides." },
        options: {
          type: "object",
          description:
            "Replace settings for individual networks, keyed by youtube, tiktok, instagram or linkedin; use null to clear one.",
        },
        copy: {
          type: "object",
          description: "Update individual account or network overrides; an empty string removes one override.",
        },
        tags: { type: "array", items: { type: "string" } },
        trackLinks: { type: "boolean" },
        media: {
          type: "array",
          items: { type: "string" },
          description:
            "Replace media with uploaded IDs; an empty list clears it. Existing metadata is kept for retained IDs.",
        },
        frames: {
          type: "array",
          items: { type: "string" },
          description: "Checked screenshot IDs of a large video's frames, required when scheduling videos over 20 MB.",
        },
        at: {
          type: "string",
          description: "draft, queue, now, or a future ISO date-time. Omit to leave the schedule unchanged.",
        },
      },
      required: ["post"],
    },
    readOnly: false,
    async run({ user }, input) {
      const postId = requiredString(input, "post").trim();
      const post = await convex.query(api.social.get, { userId: user._id, postId });
      if (!post) throw new ApiError(404, "No such post.");
      if (!post.editable) throw new ApiError(400, "Only drafts and unsent scheduled posts can be changed.");
      const at = optionalString(input, "at")?.trim();
      if (at === "") throw new ApiError(400, "at must be draft, queue, now or a date-time.");
      const special = at === undefined || at === "draft" || at === "queue" || at === "now";
      const parsed = special ? null : wallTime(at, user.timeZone);
      if (!special && parsed === null) throw new ApiError(400, "at must be draft, queue, now or a date-time.");
      let overrides = post.overrides;
      if (input.perNetwork !== undefined) {
        const given = asObject(input.perNetwork, "perNetwork");
        overrides = {};
        for (const [key, value] of Object.entries(given)) {
          if (typeof value !== "string") throw new ApiError(400, "perNetwork values must be strings.");
          overrides[key] = value;
        }
      }
      if (input.copy !== undefined) {
        const available = await convex.query(api.accounts.list, { userId: user._id });
        const selected = new Set(
          optionalStrings(input, "accounts") ??
            post.deliveries.filter((row) => !row.repost).map((row) => row.accountId),
        );
        const keys = new Set(
          available
            .filter((account) => selected.has(account._id))
            .flatMap((account) => [String(account._id), account.provider]),
        );
        overrides = { ...overrides };
        for (const [key, value] of Object.entries(asObject(input.copy, "copy"))) {
          if (!keys.has(key)) throw new ApiError(400, `No selected account or network named ${key}.`);
          if (typeof value !== "string") throw new ApiError(400, "copy values must be strings.");
          if (value.trim()) overrides[key] = value;
          else delete overrides[key];
        }
      }
      const result = await saveStudioPost(user, {
        postId,
        text: optionalString(input, "text") ?? post.text,
        link: optionalString(input, "link") ?? post.link ?? "",
        productId: post.product?.id ?? null,
        accountIds:
          optionalStrings(input, "accounts") ??
          post.deliveries.filter((row) => !row.repost).map((row) => row.accountId),
        repostAccountIds:
          optionalStrings(input, "repostAccounts") ??
          post.deliveries.filter((row) => row.repost).map((row) => row.accountId),
        media: (optionalStrings(input, "media") ?? post.media.map((item) => item.id)).map((id) => {
          const item = post.media.find((entry) => entry.id === id);
          return {
            id,
            duration: item?.duration ?? undefined,
            width: item?.width ?? undefined,
            height: item?.height ?? undefined,
            alt: item?.alt,
            coverAt: item?.coverAt ?? undefined,
          };
        }),
        frames: optionalStrings(input, "frames") ?? [],
        overrides,
        options: input.options === undefined ? post.options : networkOptions(input.options, post.options),
        scheduledAt: at === undefined ? post.scheduledAt : parsed,
        queue: at === "queue",
        draft: at === undefined ? post.draft : at === "draft",
        thread: optionalStrings(input, "thread") ?? post.thread,
        firstComment: optionalString(input, "firstComment") ?? post.firstComment,
        note: post.note,
        tags: optionalStrings(input, "tags") ?? post.tags,
        repeat: post.repeat,
        staggerMinutes: post.staggerMinutes,
        plug: post.plug,
        trackLinks: optionalBoolean(input, "trackLinks") ?? post.trackLinks,
        coverMediaId: post.cover?.id ?? null,
      });
      if (!result.ok) throw new ApiError(400, result.error);
      return await socialPostSummary(user, result.postId);
    },
  },
  {
    name: "cancel_social_post",
    title: "Cancel a scheduled social post or delete a draft",
    description: "Cancel an unsent scheduled post, or delete a draft. Nothing is posted.",
    inputSchema: { type: "object", properties: { post: { type: "string" } }, required: ["post"] },
    readOnly: false,
    async run({ user }, input) {
      const postId = requiredString(input, "post").trim();
      const post = await convex.query(api.social.get, { userId: user._id, postId });
      if (!post) throw new ApiError(404, "No such post.");
      const cancelled = post.draft
        ? await convex.mutation(api.social.discard, { userId: user._id, postId })
        : await convex.mutation(api.social.cancel, { userId: user._id, postId });
      if (!cancelled) throw new ApiError(400, "Only drafts and unsent scheduled posts can be cancelled.");
      return { id: postId, status: post.draft ? "deleted" : "cancelled" };
    },
  },
  {
    name: "get_traction",
    title: "Get a slop's traction",
    description:
      "The numbers from the slop's connected sources (Google Analytics, PostHog, Stripe, Solana wallet): people on it now, people and signups today and over 30 days, revenue and MRR in minor units, and the next round number of people. Sources are connected by the maker on the slop's edit page.",
    inputSchema: { type: "object", properties: { slop: SLOP_REF }, required: ["slop"] },
    readOnly: true,
    async run(context, input) {
      const slop = await ownSlop(context, requiredString(input, "slop"));
      const page = await convex.query(api.slops.page, {
        username: context.user.username,
        slug: slop.slug,
        asUser: context.user._id,
      });
      if (!page) throw new ApiError(404, "Slop not found.");
      const board = tractionBoard(page.traction, context.now.toISOString().slice(0, 10), context.now.getTime());
      return {
        sources: page.traction.sources.map((source) => ({
          provider: source.provider,
          public: source.public,
          status: source.status,
          error: source.error,
          syncedAt: source.syncedAt === null ? null : new Date(source.syncedAt).toISOString(),
        })),
        board: board && {
          onItNow: board.live?.people ?? null,
          people: board.people && { today: board.people.today, last30Days: board.people.days30 },
          signups: board.signups && { today: board.signups.today, last30Days: board.signups.days30 },
          revenue: board.revenue && { today: board.revenue.today, last30Days: board.revenue.days30 },
          mrr: board.mrr && { amounts: board.mrr.amounts, subscribers: board.mrr.subscribers },
          nextMilestone: board.next,
        },
      };
    },
  },
  publicOperation({
    name: "todays_race",
    title: "Today's slop of the day race",
    description:
      "Today's slops ranked by votes (UTC day), with how the user voted and their votes left (null without a token). The leader at midnight UTC becomes slop of the day and goes slopcessful.",
    inputSchema: { type: "object", properties: {} },
    readOnly: true,
    async run({ user, now }) {
      const [race, votesLeft] = await Promise.all([
        convex.query(api.race.day, { date: now.toISOString().slice(0, 10), limit: 20, asUser: user?._id }),
        convex.query(api.slops.votesLeft, { asUser: user?._id }),
      ]);
      return {
        date: race.date,
        votesLeft,
        ranking: race.items.map((item, index) => ({
          rank: index + 1,
          id: item.slop.id,
          owner: item.owner.username,
          name: item.slop.name,
          launchLabel: item.slop.launchLabel,
          tagline: item.slop.tagline,
          upvotes: item.slop.upvotes,
          url: absoluteUrl(slopPath(item.owner.username, item.slop.slug)),
          yours: item.voteMode === "own",
          yourVote: voteName(item.vote),
        })),
      };
    },
  }),
  publicOperation({
    name: "search_slops",
    title: "Search slops",
    description: `Find slops on the wall by name or by what they do. It matches meaning as well as words, so “budget” also finds an expense tracker. Best match first, at most ${SEARCH_LIMIT}; hidden slops never show, and NSFW ones only if the user turned them on.`,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", maxLength: SEARCH_QUERY_LENGTH, description: "What to look for, in plain words." },
        categories: {
          type: "array",
          items: { type: "string", enum: CATEGORIES.map((category) => category.id) },
          description: "Only these categories. Every category when left out.",
        },
        limit: { type: "integer", minimum: 1, maximum: SEARCH_LIMIT, description: "Defaults to 20." },
      },
      required: ["query"],
    },
    readOnly: true,
    async run({ user }, input) {
      const query = normalizeQuery(requiredString(input, "query"));
      const categories = optionalStrings(input, "categories") ?? [];
      const unknown = categories.filter((category) => !findCategory(category));
      if (unknown.length > 0) {
        throw new ApiError(400, `Unknown categories: ${unknown.join(", ")}. list_categories has the valid ones.`);
      }
      const limit = optionalNumber(input, "limit") ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > SEARCH_LIMIT) {
        throw new ApiError(400, `limit must be a whole number from 1 to ${SEARCH_LIMIT}.`);
      }
      const items = await convex.action(api.search.find, { query, categories, limit, asUser: user?._id });
      if (items === null) throw new ApiError(429, SEARCH_RATE_LIMIT_MESSAGE);
      return {
        query,
        results: items.map((item, index) => ({
          rank: index + 1,
          id: item.slop.id,
          owner: item.owner.username,
          name: item.slop.name,
          launchLabel: item.slop.launchLabel,
          tagline: item.slop.tagline,
          category: item.slop.category,
          nsfw: item.slop.nsfw,
          upvotes: item.slop.upvotes,
          launchDate: item.slop.launchDate,
          url: absoluteUrl(slopPath(item.owner.username, item.slop.slug)),
          yours: item.voteMode === "own",
          yourVote: voteName(item.vote),
        })),
      };
    },
  }),
  {
    name: "vote",
    title: "Vote on a slop",
    description: `Upvote a slop, downvote it (privately: it lowers the ranking and nobody sees it), or clear the vote. Everyone gets ${LIMITS.votesPerDay} votes per UTC day, so spend them on the slops that deserve to win: switching today's vote is free and clearing it gives it back. Not on the user's own slops.`,
    inputSchema: {
      type: "object",
      properties: {
        slop: { type: "string", description: "The slop's id (from todays_race)." },
        vote: { type: "string", enum: Object.keys(VOTE_INPUTS) },
      },
      required: ["slop", "vote"],
    },
    readOnly: false,
    async run({ user }, input) {
      const vote = requiredString(input, "vote");
      if (!isVoteInput(vote)) throw new ApiError(400, `vote must be one of ${Object.keys(VOTE_INPUTS).join(", ")}.`);
      const result = await convex.mutation(api.slops.vote, {
        userId: user._id,
        slopId: requiredString(input, "slop").trim(),
        value: VOTE_INPUTS[vote],
      });
      return { vote: voteName(result.vote), upvotes: result.upvotes, votesLeft: result.votesLeft };
    },
  },
  {
    name: "review_slop",
    title: "Review a slop",
    description: `Write the user's review of someone else's slop: how it went (${Object.keys(REVIEW_EXPERIENCES).join(", ")}), what it is and what they tried, and what broke, in their words, with up to ${LIMITS.reviewImages} screenshots from upload_screenshot. One review per person per slop: writing again replaces theirs. It goes up at once; one that isn't fit for a general audience is refused. Only review a slop the user actually tried, saying what they told you.`,
    inputSchema: {
      type: "object",
      properties: {
        slop: { type: "string", description: "The slop's id (from todays_race or search_slops)." },
        experience: { type: "string", enum: Object.keys(REVIEW_EXPERIENCES), description: "How it went for them." },
        body: { type: "string", maxLength: LIMITS.reviewLength, description: "Markdown." },
        images: {
          type: "array",
          items: { type: "string" },
          maxItems: LIMITS.reviewImages,
          description: "Screenshot ids from upload_screenshot, in order. Writing again without them keeps none.",
        },
      },
      required: ["slop", "experience", "body"],
    },
    readOnly: false,
    async run(context, input) {
      const parsed = validateReview({
        experience: requiredString(input, "experience"),
        body: requiredString(input, "body"),
        images: optionalStrings(input, "images"),
      });
      if (!parsed.ok) throw new ApiError(422, "The review needs fixing.", parsed.errors);
      const { slop } = await reviewsOf(context, requiredString(input, "slop"));
      const posted = await postReview(context.user._id, { id: slop.id, name: slop.name }, parsed.value);
      if (!posted.ok) throw new ApiError(422, posted.error);
      if (posted.orphaned > 0) await deleteOrphanedMedia();
      return {
        review: {
          id: posted.reviewId,
          experience: parsed.value.experience,
          url: `${absoluteUrl(slopPath(slop.username, slop.slug))}#review-${posted.reviewId}`,
          replaced: !posted.created,
        },
      };
    },
  },
  publicOperation({
    name: "list_reviews",
    title: "Read a slop's reviews",
    description:
      "What people who tried a slop said: how it went (works, mixed or broken), their words and screenshots, newest first. Use it on the user's own slops for feedback: what to fix and what people like.",
    inputSchema: {
      type: "object",
      properties: {
        slop: { type: "string", description: "Any slop's id, or the slug of one of the user's slops." },
      },
      required: ["slop"],
    },
    readOnly: true,
    async run(context, input) {
      const { slop, reviews } = await reviewsOf(context, requiredString(input, "slop"));
      return {
        slop: { id: slop.id, name: slop.name, url: absoluteUrl(slopPath(slop.username, slop.slug)) },
        reviews: reviews.map((review) => ({
          ...review,
          createdAt: new Date(review.createdAt).toISOString(),
          editedAt: review.editedAt === null ? null : new Date(review.editedAt).toISOString(),
        })),
      };
    },
  }),
];

/** What a call that needs a token gets without one. */
export function missingToken(): ApiError {
  return new ApiError(401, `Missing or invalid API token. Create one at ${absoluteUrl("/settings/api")}`);
}

export function findOperation(name: string): Operation | undefined {
  return OPERATIONS.find((operation) => operation.name === name);
}

/**
 * Runs an operation with raw, untrusted input. Business-rule errors become
 * ApiErrors. Only public operations run without a signed-in user.
 */
export async function runOperation(operation: Operation, context: ViewerContext, input: unknown): Promise<unknown> {
  const { user } = context;
  if (!operation.public && !user) throw missingToken();
  try {
    const args = asObject(input, "arguments");
    if (operation.public) return await operation.run(context, args);
    if (!user) throw missingToken();
    return await operation.run({ ...context, user }, args);
  } catch (error) {
    const message = convexMessage(error);
    if (message) throw new ApiError(409, message);
    throw error;
  }
}
