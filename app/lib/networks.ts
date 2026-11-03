/**
 * What each social network takes, in one table the composer, its previews
 * and the server's adapters all read. The composer uses it to say what a
 * post will look like on every network before anything is sent, and why a
 * network can't take a post (Instagram without a picture, YouTube without a
 * video), so nothing is refused after the fact.
 */

export const SOCIAL_PROVIDERS = [
  "x",
  "linkedin",
  "bluesky",
  "threads",
  "facebook",
  "instagram",
  "tiktok",
  "youtube",
] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

export function isSocialProvider(value: string): value is SocialProvider {
  return (SOCIAL_PROVIDERS as readonly string[]).includes(value);
}

/** What a network does with a post's media. */
export interface NetworkSpec {
  label: string;
  /** Character budget for the post's words, measured as the network measures it. */
  textLimit: number;
  /** Most pictures one post can carry; 0 when the network takes none. */
  maxImages: number;
  /** Whether it takes a video, and how long one may run. */
  video: { maxSeconds: number } | null;
  /** A post must carry this. */
  needs: "nothing" | "media" | "video";
  /** The network can repost another connected account's post. */
  canRepost: boolean;
  /** Post stats an app can read. Null says why it can't. */
  stats: readonly StatName[] | { unavailable: string };
  /** A title on top of the words (YouTube). */
  title?: { limit: number };
  /** What one connected account is on this network. */
  accountNoun: string;
  /** Later posts go out as a thread of replies. */
  threads: boolean;
  /** A first comment can go under the post. */
  firstComment: boolean;
  /** Pictures carry alt text. */
  altText: boolean;
  /** Takes a PDF as a document post. */
  documents: boolean;
  /** A sent post can be taken down from the studio. */
  canRemove: boolean;
  /** Comments on a sent post can be read in the studio, and answered when `replies` is true. */
  comments: { replies: boolean } | null;
}

export type StatName = "views" | "likes" | "comments" | "shares" | "saves" | "reposts";

export const STAT_LABELS: Record<StatName, string> = {
  views: "Views",
  likes: "Likes",
  comments: "Comments",
  shares: "Shares",
  saves: "Saves",
  reposts: "Reposts",
};

export const NETWORKS: Record<SocialProvider, NetworkSpec> = {
  x: {
    label: "X",
    textLimit: 280,
    maxImages: 4,
    video: { maxSeconds: 140 },
    needs: "nothing",
    canRepost: true,
    stats: ["views", "likes", "comments", "reposts", "saves"],
    accountNoun: "account",
    threads: true,
    firstComment: true,
    altText: true,
    documents: false,
    canRemove: true,
    comments: null,
  },
  linkedin: {
    label: "LinkedIn",
    textLimit: 3000,
    maxImages: 9,
    video: { maxSeconds: 600 },
    needs: "nothing",
    canRepost: false,
    stats: { unavailable: "LinkedIn only shares post stats with its approved partners." },
    accountNoun: "profile",
    threads: false,
    firstComment: true,
    altText: true,
    documents: true,
    canRemove: true,
    comments: null,
  },
  bluesky: {
    label: "Bluesky",
    textLimit: 300,
    maxImages: 4,
    video: null,
    needs: "nothing",
    canRepost: true,
    stats: ["likes", "comments", "reposts"],
    accountNoun: "account",
    threads: true,
    firstComment: true,
    altText: true,
    documents: false,
    canRemove: true,
    comments: { replies: true },
  },
  threads: {
    label: "Threads",
    textLimit: 500,
    maxImages: 10,
    video: { maxSeconds: 300 },
    needs: "nothing",
    canRepost: true,
    stats: ["views", "likes", "comments", "reposts", "shares"],
    accountNoun: "profile",
    threads: true,
    firstComment: true,
    altText: true,
    documents: false,
    canRemove: true,
    comments: { replies: true },
  },
  facebook: {
    label: "Facebook",
    textLimit: 63_206,
    maxImages: 10,
    video: { maxSeconds: 14_400 },
    needs: "nothing",
    canRepost: false,
    stats: ["likes", "comments", "shares"],
    accountNoun: "Page",
    threads: false,
    firstComment: true,
    altText: false,
    documents: false,
    canRemove: true,
    comments: { replies: true },
  },
  instagram: {
    label: "Instagram",
    textLimit: 2200,
    maxImages: 10,
    video: { maxSeconds: 900 },
    needs: "media",
    canRepost: false,
    stats: ["views", "likes", "comments", "shares", "saves"],
    accountNoun: "professional account",
    threads: false,
    firstComment: true,
    altText: true,
    documents: false,
    canRemove: false,
    comments: { replies: true },
  },
  tiktok: {
    label: "TikTok",
    textLimit: 2200,
    maxImages: 0,
    video: { maxSeconds: 600 },
    needs: "video",
    canRepost: false,
    stats: ["views", "likes", "comments", "shares"],
    accountNoun: "account",
    threads: false,
    firstComment: false,
    altText: false,
    documents: false,
    canRemove: false,
    comments: null,
  },
  youtube: {
    label: "YouTube",
    textLimit: 5000,
    maxImages: 0,
    video: { maxSeconds: 43_200 },
    needs: "video",
    canRepost: false,
    stats: ["views", "likes", "comments"],
    title: { limit: 100 },
    accountNoun: "channel",
    threads: false,
    firstComment: false,
    altText: false,
    documents: false,
    canRemove: false,
    comments: { replies: false },
  },
};

/** The stats a network shares with apps; empty when it shares none. */
export function statsOf(provider: SocialProvider): readonly StatName[] {
  const stats = NETWORKS[provider].stats;
  return "unavailable" in stats ? [] : (stats as readonly StatName[]);
}

/** Why a network shares no stats, or null when it does. */
export function statsUnavailable(provider: SocialProvider): string | null {
  const stats = NETWORKS[provider].stats;
  return "unavailable" in stats ? stats.unavailable : null;
}

export const NETWORK_LABELS: Record<SocialProvider, string> = Object.fromEntries(
  SOCIAL_PROVIDERS.map((provider) => [provider, NETWORKS[provider].label]),
) as Record<SocialProvider, string>;

/** What a post carries, as far as fitting it to a network goes. */
export interface PostShape {
  images: number;
  /** Seconds, when the post has a video. */
  video: number | null;
  /** PDFs, for LinkedIn document posts. */
  documents?: number;
}

/** X Premium accounts post up to this many characters. */
export const X_LONG_LIMIT = 25_000;

/** The character budget for one account: X Premium accounts get long posts. */
export function textLimitFor(provider: SocialProvider, account?: { longPosts?: boolean }): number {
  return provider === "x" && account?.longPosts ? X_LONG_LIMIT : NETWORKS[provider].textLimit;
}

/**
 * Why `provider` can't take a post of this shape, or null when it can. The
 * composer shows this next to the account, before anything is sent.
 */
export function unsupportedReason(provider: SocialProvider, shape: PostShape): string | null {
  const spec = NETWORKS[provider];
  const hasVideo = shape.video !== null;
  if (shape.documents) {
    if (!spec.documents) return `${spec.label} doesn't take documents. Only LinkedIn does.`;
    if (shape.documents > 1 || shape.images > 0 || hasVideo) return "A document goes on its own.";
    return null;
  }
  if (spec.needs === "video" && !hasVideo) return `${spec.label} needs a video.`;
  if (spec.needs === "media" && !hasVideo && shape.images === 0) return `${spec.label} needs a picture or a video.`;
  if (hasVideo && !spec.video) return `${spec.label} can't take videos from apps yet.`;
  if (hasVideo && spec.video && shape.video! > spec.video.maxSeconds) {
    return `${spec.label} takes videos up to ${formatSeconds(spec.video.maxSeconds)}.`;
  }
  if (hasVideo && shape.images > 0) return "Pick pictures or a video, not both.";
  if (!hasVideo && shape.images > spec.maxImages) {
    return spec.maxImages === 0
      ? `${spec.label} doesn't take pictures.`
      : `${spec.label} takes up to ${spec.maxImages} pictures.`;
  }
  return null;
}

export function formatSeconds(seconds: number): string {
  if (seconds >= 3600) return `${Math.round(seconds / 3600)} hours`;
  if (seconds >= 60) return `${Math.round(seconds / 60)} minutes`;
  return `${seconds} seconds`;
}

/** What one post is called on each network, for receipts ("Reel on Instagram"). */
export function formatName(provider: SocialProvider, shape: PostShape, instagram?: InstagramFormat): string {
  const hasVideo = shape.video !== null;
  if (shape.documents) return "Document";
  switch (provider) {
    case "instagram":
      if (instagram === "story") return "Story";
      return hasVideo ? "Reel" : shape.images > 1 ? "Carousel" : "Post";
    case "youtube":
      return shape.video !== null && shape.video <= 180 ? "Short" : "Video";
    case "tiktok":
      return "Video";
    default:
      return "Post";
  }
}

// ---------------------------------------------------------------------------
// Network options: what the composer asks only when that network is picked.

export const YOUTUBE_PRIVACY = ["public", "unlisted", "private"] as const;
export type YouTubePrivacy = (typeof YOUTUBE_PRIVACY)[number];

export interface YouTubeOptions {
  title: string;
  privacy: YouTubePrivacy;
  /** YouTube makes every uploader say whether a video is made for kids. */
  madeForKids: boolean;
}

/**
 * TikTok's posting rules: the person picks who can see it (no default), and
 * whether people can comment, duet and stitch; branded content is
 * disclosed. Unaudited apps can only post privately.
 */
export const TIKTOK_PRIVACY = [
  "PUBLIC_TO_EVERYONE",
  "MUTUAL_FOLLOW_FRIENDS",
  "FOLLOWER_OF_CREATOR",
  "SELF_ONLY",
] as const;
export type TikTokPrivacy = (typeof TIKTOK_PRIVACY)[number];

export const TIKTOK_PRIVACY_LABELS: Record<TikTokPrivacy, string> = {
  PUBLIC_TO_EVERYONE: "Everyone",
  MUTUAL_FOLLOW_FRIENDS: "Friends",
  FOLLOWER_OF_CREATOR: "Followers",
  SELF_ONLY: "Only me",
};

export interface TikTokOptions {
  privacy: TikTokPrivacy | null;
  allowComments: boolean;
  allowDuet: boolean;
  allowStitch: boolean;
  /** Promoting someone else's brand (a paid partnership). */
  brandedContent: boolean;
  /** Promoting your own business. */
  yourBrand: boolean;
}

export const INSTAGRAM_FORMATS = ["feed", "story"] as const;
export type InstagramFormat = (typeof INSTAGRAM_FORMATS)[number];

export interface NetworkOptions {
  youtube?: YouTubeOptions;
  tiktok?: TikTokOptions;
  instagram?: { format: InstagramFormat; collaborators?: string[] };
  linkedin?: { documentTitle: string };
}

/** Problems with the options for the networks picked, worded for the composer. */
export function optionProblems(providers: ReadonlySet<SocialProvider>, options: NetworkOptions): string[] {
  const problems: string[] = [];
  if (providers.has("youtube")) {
    const title = options.youtube?.title.trim() ?? "";
    if (!title) problems.push("Give the YouTube video a title.");
    else if (title.length > NETWORKS.youtube.title!.limit) problems.push("YouTube titles are up to 100 characters.");
    if (/[<>]/.test(title)) problems.push("YouTube titles can't have < or >.");
  }
  const collaborators = options.instagram?.collaborators ?? [];
  if (collaborators.length > 3) problems.push("Instagram takes up to 3 collaborators.");
  if (collaborators.some((name) => !/^[A-Za-z0-9._]{1,30}$/.test(name))) {
    problems.push("Instagram collaborators are usernames, like tiltmaze.app.");
  }
  if (providers.has("tiktok")) {
    const tiktok = options.tiktok;
    if (!tiktok?.privacy) problems.push("Choose who can see the TikTok.");
    if (tiktok?.brandedContent && tiktok.privacy === "SELF_ONLY") {
      problems.push("Branded content on TikTok can't be private.");
    }
  }
  return problems;
}
