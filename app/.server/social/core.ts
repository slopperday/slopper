import type { Doc } from "@convex/_generated/dataModel";
import type { PostContent } from "~/lib/compose";
import type { NetworkOptions, SocialProvider } from "~/lib/networks";
import { seal, unseal } from "../crypto";

/**
 * What every network adapter shares: the account, the post it's given, what
 * it hands back, and how a network's refusal reaches the person.
 */

export type ConnectedAccount = Doc<"accounts">;

export interface PublishedPost {
  provider: SocialProvider;
  remoteId: string;
  url: string;
  /** Network specific reference needed to repost (Bluesky CID). */
  cid?: string;
}

/** A picture or video on a studio post, where the network (or this server) can fetch it. */
export interface DraftMedia {
  kind: "image" | "video" | "document";
  /** What a picture shows. */
  alt?: string;
  /** The second of a video to take its cover from. */
  coverAt?: number;
  url: string;
  contentType: string;
  size: number;
  /** Seconds, for a video. */
  duration?: number;
  width?: number;
  height?: number;
}

/** One network's copy of a studio post: the words already fitted to it. */
export interface Draft {
  text: string;
  link: string | null;
  media: readonly DraftMedia[];
  options: NetworkOptions;
  /** A custom thumbnail picture's URL (YouTube). */
  thumbnailUrl?: string | null;
}

/** What a reply goes under: a post (or comment), and the thread's first post where the network needs it. */
export interface ReplyRef {
  remoteId: string;
  /** Bluesky's content ids. */
  cid?: string;
  rootId?: string;
  rootCid?: string;
  /** Instagram answers comments differently from posts. */
  kind?: "post" | "comment";
}

/** A comment someone left on a sent post. */
export interface SocialComment {
  id: string;
  cid?: string;
  author: string;
  text: string;
  at: string | null;
}

/**
 * How a send went. Uploads some networks process before they post
 * (Instagram, TikTok, X videos) come back `processing`, with a note the
 * adapter reads in `resume` later. The note is stored in Convex in the
 * clear, so it never holds a secret.
 */
export type SendResult =
  | { status: "ok"; post: PublishedPost }
  | { status: "processing"; pending: string; retryAfterMs: number };

export interface PostRef {
  remoteId: string;
  url: string | null;
}

export interface PostMetrics {
  views?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  reposts?: number;
}

export interface SocialAdapter {
  /** A launch or update's link post (auto-post). */
  publish(account: ConnectedAccount, content: PostContent): Promise<PublishedPost>;
  /** Absent when the network has no API for reposting. */
  amplify?(account: ConnectedAccount, post: PublishedPost): Promise<void>;
  /** A studio post, with its pictures or video. */
  send(account: ConnectedAccount, draft: Draft): Promise<SendResult>;
  /** Picks up an upload `send` left processing. */
  resume?(account: ConnectedAccount, pending: string, draft: Draft): Promise<SendResult>;
  /** Latest stats for sent posts, by remote id. Missing ids had nothing to report. */
  metrics?(account: ConnectedAccount, posts: readonly PostRef[]): Promise<Map<string, PostMetrics>>;
  /** Replies under a post or comment: the thread's next post, a first comment, an answer to someone. */
  reply?(account: ConnectedAccount, parent: ReplyRef, text: string): Promise<{ remoteId: string; cid?: string }>;
  /** Takes a sent post down. */
  remove?(account: ConnectedAccount, remoteId: string): Promise<void>;
  /** The latest comments on a sent post. */
  comments?(account: ConnectedAccount, post: ReplyRef): Promise<SocialComment[]>;
}

/** What launch auto-posts need from a network. */
export type LaunchAdapter = Pick<SocialAdapter, "publish" | "amplify">;

export class SocialError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** The network may have taken the post anyway, so resending could post it twice. */
    readonly uncertain = false,
  ) {
    super(message);
    this.name = "SocialError";
  }
}

export async function sealCredentials(credentials: object): Promise<string> {
  return await seal(JSON.stringify(credentials));
}

export async function openCredentials<T>(account: ConnectedAccount): Promise<T> {
  return JSON.parse(await unseal(account.sealedCredentials)) as T;
}

/** The network's own explanation, when its error body has one. */
export function errorDetail(body: string): string | null {
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    const nested =
      typeof json.error === "object" && json.error !== null ? (json.error as Record<string, unknown>) : null;
    const detail =
      json.detail ??
      json.message ??
      json.error_description ??
      json.title ??
      nested?.error_user_msg ??
      nested?.message ??
      json.error;
    return typeof detail === "string" && detail.trim() ? detail.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Turns a refusal into what the maker sees: the network's own words when it
 * gave some, never a status code or a raw body. Those go to the logs. A
 * server error may have happened after the post was made, so it's uncertain.
 */
export async function expectOk(response: Response, network: string): Promise<void> {
  if (response.ok) return;
  const body = await response.text();
  console.warn(`${network} refused a request (${response.status}): ${body.slice(0, 500)}`);
  const detail = errorDetail(body);
  throw new SocialError(
    detail ? `${network} turned it down: ${detail}` : `${network} turned it down. Try again later.`,
    response.status,
    response.status >= 500,
  );
}

/** Reads a JSON answer after `expectOk`. */
export async function okJson<T>(response: Response, network: string): Promise<T> {
  await expectOk(response, network);
  return (await response.json()) as T;
}

/** Fetches a screenshot for a link card, if it is small enough. */
export async function loadImage(
  url: string | null,
  maxBytes: number,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) return null;
  return { bytes, contentType: response.headers.get("content-type") ?? "image/png" };
}

/**
 * The bytes of a studio post's media, for networks that take uploads rather
 * than fetching a URL. The URL is this server's own storage, never one a
 * person typed.
 */
export async function loadMedia(media: DraftMedia): Promise<Uint8Array<ArrayBuffer>> {
  const response = await fetch(media.url, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new SocialError("Couldn't read the upload back from storage. Try again.");
  return new Uint8Array(await response.arrayBuffer());
}

/** A launch's link post, as a studio draft: for networks whose only way to post is `send`. */
export function contentToDraft(text: string, content: PostContent): Draft {
  return {
    text,
    link: content.url,
    media: content.imageUrl ? [{ kind: "image", url: content.imageUrl, contentType: "image/jpeg", size: 0 }] : [],
    options: {},
  };
}

/**
 * Sends and waits briefly for processing, for callers that can't come back
 * later (launch auto-posts). Gives up with an error past `budgetMs`.
 */
export async function sendAndWait(
  adapter: SocialAdapter,
  account: ConnectedAccount,
  draft: Draft,
  budgetMs = 25_000,
): Promise<PublishedPost> {
  const until = Date.now() + budgetMs;
  let result = await adapter.send(account, draft);
  while (result.status === "processing") {
    if (!adapter.resume || Date.now() + result.retryAfterMs > until) {
      throw new SocialError("It's still processing there. Check the account in a minute.", undefined, true);
    }
    await new Promise((resolve) => setTimeout(resolve, result.status === "processing" ? result.retryAfterMs : 0));
    result = await adapter.resume(account, result.pending, draft);
  }
  return result.post;
}

/** A number from a network's JSON, or undefined. */
export function count(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) ? n : undefined;
}
