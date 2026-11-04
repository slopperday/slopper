import { measureFor } from "./compose";
import {
  NETWORKS,
  type NetworkOptions,
  optionProblems,
  type PostShape,
  type SocialProvider,
  textLimitFor,
  unsupportedReason,
} from "./networks";
import { hasSpintax } from "./variables";

/**
 * One idea, many destinations. A studio post has shared words, a link, media
 * and a first comment; each network, or one account, can have its own version
 * of any of them (`overrides` for words, `variants` for the rest), falling
 * back to the network's version and then the shared one. The composer, the
 * server's save and the agents all read a destination's copy and its
 * readiness through this file, so they never disagree.
 */

/** What one network or account gets instead of the shared version. Absent fields use the shared one. */
export interface Variant {
  /** Ids of the post's uploads this destination gets, in order. */
  media?: string[];
  /** Its own link; null for none. */
  link?: string | null;
  firstComment?: string;
}

export interface DestinationPost {
  text: string;
  link: string | null;
  media: readonly { id: string; kind: "image" | "video" | "document"; duration?: number | null }[];
  overrides: Readonly<Record<string, string | undefined>>;
  variants?: Readonly<Record<string, Variant | undefined>>;
  options: NetworkOptions;
  thread?: readonly string[];
  firstComment?: string;
}

export interface DestinationAccount {
  id: string;
  provider: SocialProvider;
  handle: string;
  broken?: string | null;
  longPosts?: boolean;
}

/** The variant that applies, field by field: the account's, then the network's. */
function pick<K extends keyof Variant>(
  post: DestinationPost,
  account: DestinationAccount,
  key: K,
): Variant[K] | undefined {
  const own = post.variants?.[account.id];
  if (own && own[key] !== undefined) return own[key];
  const network = post.variants?.[account.provider];
  if (network && network[key] !== undefined) return network[key];
  return undefined;
}

export interface Destination {
  text: string;
  link: string | null;
  media: DestinationPost["media"];
  firstComment: string;
  /** Where each part came from, for "Use shared version". */
  own: { text: boolean; link: boolean; media: boolean; firstComment: boolean };
}

/** What one account will post, before variables and fitting. */
export function destinationFor(post: DestinationPost, account: DestinationAccount): Destination {
  const ownText = post.overrides[account.id]?.trim() || post.overrides[account.provider]?.trim();
  const link = pick(post, account, "link");
  const mediaIds = pick(post, account, "media");
  const comment = pick(post, account, "firstComment");
  return {
    text: ownText || post.text,
    link: link === undefined ? post.link : link,
    media: mediaIds === undefined ? post.media : mediaIds.flatMap((id) => post.media.filter((item) => item.id === id)),
    firstComment: comment === undefined ? (post.firstComment ?? "") : comment,
    own: {
      text: !!ownText,
      link: link !== undefined,
      media: mediaIds !== undefined,
      firstComment: comment !== undefined,
    },
  };
}

export function shapeOf(media: DestinationPost["media"]): PostShape {
  const video = media.find((item) => item.kind === "video");
  return {
    images: media.filter((item) => item.kind === "image").length,
    video: video ? (video.duration ?? 0) : null,
    documents: media.filter((item) => item.kind === "document").length,
  };
}

/** The field that fixes an issue, so the composer can take the person straight to it. */
export type IssueField =
  | "account"
  | "text"
  | "media"
  | "link"
  | "youtube"
  | "tiktok"
  | "instagram"
  | "linkedin"
  | "copy";

export interface Issue {
  /** `block`: it can't be sent like this. `warn`: it can, but probably shouldn't. `info`: worth knowing. */
  level: "block" | "warn" | "info";
  message: string;
  field: IssueField;
}

/** X's prices per post created, from its price list (docs.x.com/x-api/getting-started/pricing), November 2026. */
export const X_PRICES = { post: 0.015, postWithLink: 0.2 } as const;

function normalize(words: string): string {
  return words.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * X forbids automated duplicate or substantially similar posts across
 * accounts one person runs (help.x.com, "X automation rules"). Returns the
 * handles of the other picked X accounts that would post the same words as
 * this one. Spintax counts as different words.
 */
export function xTwins(
  post: DestinationPost,
  account: DestinationAccount,
  picked: readonly DestinationAccount[],
): string[] {
  if (account.provider !== "x") return [];
  const words = destinationFor(post, account).text;
  if (hasSpintax(words)) return [];
  return picked
    .filter((other) => other.provider === "x" && other.id !== account.id)
    .filter((other) => normalize(destinationFor(post, other).text) === normalize(words))
    .map((other) => other.handle);
}

/**
 * Everything that stands between this account and a good post, worst first:
 * the composer's checklist, the agents' preflight, and (for `block`) the
 * server refusing to send.
 */
export function readiness(
  post: DestinationPost,
  account: DestinationAccount,
  picked: readonly DestinationAccount[],
): Issue[] {
  const issues: Issue[] = [];
  const spec = NETWORKS[account.provider];
  const copy = destinationFor(post, account);
  if (account.broken)
    issues.push({ level: "block", message: `Needs reconnecting: ${account.broken}`, field: "account" });
  if (!copy.text.trim() && copy.media.length === 0) {
    issues.push({ level: "block", message: "Write something or add media.", field: "text" });
  }
  const reason = unsupportedReason(account.provider, shapeOf(copy.media));
  if (reason) issues.push({ level: "block", message: reason, field: "media" });
  for (const problem of optionProblems(new Set([account.provider]), post.options)) {
    const field: IssueField =
      account.provider === "youtube" ? "youtube" : account.provider === "tiktok" ? "tiktok" : "instagram";
    issues.push({ level: "block", message: problem, field });
  }
  const twins = xTwins(post, account, picked);
  if (twins.length) {
    issues.push({
      level: "block",
      message: `Same words as ${twins.map((handle) => `@${handle}`).join(", ")}. X doesn't allow the same automated post from several accounts: give each its own version.`,
      field: "copy",
    });
  }
  const measure = measureFor(account.provider);
  const unclickable = account.provider === "instagram" || account.provider === "tiktok";
  const suffix = copy.link && !unclickable && !copy.text.includes(copy.link) ? `\n\n${copy.link}` : "";
  if (measure(copy.text.trim() + suffix) > textLimitFor(account.provider, account)) {
    issues.push({
      level: "warn",
      message: "Too long: it will be shortened to fit. Write a shorter version.",
      field: "copy",
    });
  }
  if (copy.link && unclickable) {
    issues.push({ level: "info", message: `${spec.label} doesn't make links clickable in posts.`, field: "link" });
  }
  if (account.provider === "x") {
    const price = copy.link ? X_PRICES.postWithLink : X_PRICES.post;
    issues.push({
      level: "info",
      message: `X bills the developer app about $${price.toFixed(3).replace(/0$/, "")} for this post${copy.link ? " (posts with a link cost more)" : ""}.`,
      field: "link",
    });
  }
  if (account.provider === "tiktok" && post.options.tiktok?.privacy === "SELF_ONLY") {
    issues.push({ level: "info", message: "Only you will see it on TikTok.", field: "tiktok" });
  }
  return issues;
}

/** The headline for an account in the checklist: "Ready", or its worst issue. */
export function readinessLabel(issues: readonly Issue[]): { tone: "ready" | "warn" | "block"; text: string } {
  const block = issues.find((issue) => issue.level === "block");
  if (block) return { tone: "block", text: block.message };
  const warn = issues.find((issue) => issue.level === "warn");
  if (warn) return { tone: "warn", text: warn.message };
  return { tone: "ready", text: "Ready" };
}
