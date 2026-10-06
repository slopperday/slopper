/**
 * The Slopper domain model. Records are stored as-is in Deno KV, so every
 * field must be structured-clone friendly (no classes, no functions).
 */

export const CATEGORIES = [
  { id: "productivity", label: "Productivity", emoji: "📋" },
  { id: "games", label: "Games", emoji: "🕹️" },
  { id: "dev-tools", label: "Dev tools", emoji: "🛠️" },
  { id: "ai", label: "AI", emoji: "🤖" },
  { id: "creative", label: "Creative", emoji: "🎨" },
  { id: "social", label: "Social", emoji: "💬" },
  { id: "learning", label: "Learning", emoji: "📚" },
  { id: "health", label: "Health", emoji: "🌱" },
  { id: "money", label: "Money", emoji: "💸" },
  { id: "music", label: "Music & audio", emoji: "🎧" },
  { id: "crypto", label: "Crypto", emoji: "◎" },
  { id: "utilities", label: "Utilities", emoji: "🔧" },
  { id: "weird", label: "Weird", emoji: "🌀" },
] as const;

export type CategoryId = (typeof CATEGORIES)[number]["id"];
export type Category = (typeof CATEGORIES)[number];

export function findCategory(id: string): Category | undefined {
  return CATEGORIES.find((category) => category.id === id);
}

export type Platform = "web" | "ios" | "android" | "code" | "other";

export interface LinkKindInfo {
  label: string;
  platform: Platform;
  /** Pre-release channels. They still count as a launch. */
  beta: boolean;
  /** Hosts the URL must live on, when the kind is tied to a store. */
  hosts?: readonly string[];
  placeholder: string;
}

export const LINK_KINDS = {
  website: {
    label: "Website",
    platform: "web",
    beta: false,
    placeholder: "https://my-slop.app",
  },
  app_store: {
    label: "App Store",
    platform: "ios",
    beta: false,
    hosts: ["apps.apple.com"],
    placeholder: "https://apps.apple.com/app/…",
  },
  testflight: {
    label: "TestFlight beta",
    platform: "ios",
    beta: true,
    hosts: ["testflight.apple.com"],
    placeholder: "https://testflight.apple.com/join/…",
  },
  play_store: {
    label: "Google Play",
    platform: "android",
    beta: false,
    hosts: ["play.google.com"],
    placeholder: "https://play.google.com/store/apps/details?id=…",
  },
  play_beta: {
    label: "Android beta",
    platform: "android",
    beta: true,
    hosts: ["play.google.com", "appdistribution.firebase.dev"],
    placeholder: "https://play.google.com/apps/testing/…",
  },
  source: {
    label: "Source code",
    platform: "code",
    beta: false,
    placeholder: "https://github.com/you/slop",
  },
  other: {
    label: "Other link",
    platform: "other",
    beta: false,
    placeholder: "https://…",
  },
} as const satisfies Record<string, LinkKindInfo>;

export type LinkKind = keyof typeof LINK_KINDS;

export function isLinkKind(value: string): value is LinkKind {
  return Object.hasOwn(LINK_KINDS, value);
}

export interface SlopLink {
  kind: LinkKind;
  url: string;
}

export interface User {
  id: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string;
  website: string | null;
  /** IANA time zone. Midnight here is when "today" ends for this person. */
  timeZone: string;
  showNsfw: boolean;
  createdAt: string;
}

export type LoginProvider = "github" | "google" | "dev";

/** A goal like "30 slops in 30 days". One can be open at a time. */
export interface Goal {
  id: string;
  userId: string;
  title: string;
  /** Number of slops promised. */
  target: number;
  /** Length of the goal in days. */
  days: number;
  /** First day, as a calendar date in the owner's time zone. */
  startDate: string;
  abandonedAt: string | null;
  createdAt: string;
}

export type CrosspostMode = "post" | "amplify" | "off";

/**
 * One launch: an app, a site, a game, a beta. A product can launch more than
 * once (the website, then the iOS app, then 2.0); every launch is its own
 * slop with its own votes and race, linked by `productId`.
 */
export interface Slop {
  id: string;
  userId: string;
  /** Id of the product's first launch; equals `id` for a first launch. */
  productId: string;
  /** What this launch is, e.g. "iOS app" or "2.0". Null for the first launch. */
  launchLabel: string | null;
  slug: string;
  name: string;
  tagline: string;
  /** Markdown. */
  description: string;
  category: CategoryId;
  nsfw: boolean;
  links: SlopLink[];
  /** Media ids, in display order. */
  screenshots: string[];
  madeWith: string[];
  /** Calendar date of the launch in the owner's time zone. */
  launchDate: string;
  launchedAt: string;
  goalId: string | null;
  goalDay: number | null;
  /** Length of that goal, frozen at launch for "Day 7/30" labels. */
  goalLength: number | null;
  /** Global launch sequence: "Slop #42" is the 42nd slop on Slopper. */
  number: number;
  upvotes: number;
  /** Never shown publicly; only used for ranking. */
  downvotes: number;
  commentCount: number;
  updateCount: number;
  /** Real-world tests logged: demos, conversations, people who tried it. */
  fieldTests: number;
  /** "Take my money" pledges: how many people, and how much in USD cents. */
  backers: number;
  pledged: number;
  lastActivityAt: string;
  /** UTC date this slop won slop of the day, if it ever did. */
  slopOfTheDay: string | null;
  /** Set when the owner declares a breakout: users, revenue, virality. */
  slopcessfulAt: string | null;
  slopcessfulNote: string | null;
  /** Per connected account override of how updates are auto-posted. */
  crosspost: Record<string, CrosspostMode>;
  hidden: boolean;
  updatedAt: string;
}

export const UPDATE_KINDS = {
  launch: { label: "Launch" },
  update: { label: "Update" },
  feature: { label: "New feature" },
  field: { label: "Field test" },
  repromote: { label: "Re-promote" },
  slopcessful: { label: "Slopcessful" },
} as const;

export type UpdateKind = keyof typeof UPDATE_KINDS;

/** Kinds a person can post by hand from the update composer. */
export const POSTABLE_UPDATE_KINDS = ["update", "feature", "field", "repromote"] as const;
export type PostableUpdateKind = (typeof POSTABLE_UPDATE_KINDS)[number];

export function isPostableUpdateKind(value: string): value is PostableUpdateKind {
  return (POSTABLE_UPDATE_KINDS as readonly string[]).includes(value);
}

export type SocialProvider = "x" | "linkedin" | "bluesky";

export const NETWORK_LABELS: Record<SocialProvider, string> = {
  x: "X",
  linkedin: "LinkedIn",
  bluesky: "Bluesky",
};

export interface CrosspostResult {
  accountId: string;
  provider: SocialProvider;
  handle: string;
  mode: Exclude<CrosspostMode, "off">;
  status: "ok" | "error" | "skipped";
  url: string | null;
  message: string | null;
  at: string;
}

export interface SlopUpdate {
  id: string;
  slopId: string;
  userId: string;
  kind: UpdateKind;
  /** Markdown. */
  body: string;
  crossposts: CrosspostResult[];
  createdAt: string;
}

export type CommentKind = "feedback" | "kudos";

export interface Comment {
  id: string;
  slopId: string;
  userId: string;
  kind: CommentKind;
  body: string;
  createdAt: string;
}

export interface ConnectedAccount {
  id: string;
  userId: string;
  provider: SocialProvider;
  /** The provider's stable id for the account (X user id, LinkedIn sub, DID). */
  remoteId: string;
  handle: string;
  displayName: string;
  avatarUrl: string | null;
  /** Encrypted JSON credentials. Never leaves the server. */
  sealedCredentials: string;
  /** When the credentials stop working without a reconnect. */
  expiresAt: string | null;
  defaultMode: CrosspostMode;
  createdAt: string;
}

/** What the browser may see about a connected account. */
export type PublicAccount = Omit<ConnectedAccount, "sealedCredentials">;

export function publicAccount(account: ConnectedAccount): PublicAccount {
  const { sealedCredentials: _sealed, ...rest } = account;
  return rest;
}

export interface MediaMeta {
  id: string;
  ownerId: string;
  contentType: string;
  size: number;
  chunkCount: number;
  createdAt: string;
}

export interface Report {
  id: string;
  slopId: string;
  reporterId: string;
  reason: string;
  createdAt: string;
}

export const LIMITS = {
  nameLength: 60,
  taglineLength: 120,
  descriptionLength: 5000,
  updateLength: 2000,
  commentLength: 1000,
  bioLength: 280,
  slopcessfulNoteLength: 140,
  launchLabelLength: 40,
  ledgerNoteLength: 120,
  /** $10,000 in cents: a pledge, not a wire transfer. */
  maxPledge: 1_000_000,
  links: 6,
  screenshots: 6,
  madeWith: 6,
  mediaBytes: 2 * 1024 * 1024,
  goalDays: 365,
} as const;

/** What anyone may see about a slop: no downvotes, no auto-post wiring. */
export type PublicSlop = Omit<Slop, "downvotes" | "crosspost">;

export function publicSlop(slop: Slop): PublicSlop {
  const { downvotes: _downvotes, crosspost: _crosspost, ...rest } = slop;
  return rest;
}

/** What anyone may see about a person. */
export type PublicUser = Pick<User, "id" | "username" | "displayName" | "avatarUrl" | "bio" | "website" | "createdAt">;

export function publicUser(user: User): PublicUser {
  const { id, username, displayName, avatarUrl, bio, website, createdAt } = user;
  return { id, username, displayName, avatarUrl, bio, website, createdAt };
}

export type FlashTone = "info" | "success" | "error";

export interface Flash {
  tone: FlashTone;
  message: string;
}

export const COST_CATEGORIES = ["domain", "hosting", "ai", "tools", "design", "marketing", "other"] as const;
export const REVENUE_CATEGORIES = ["sales", "subscriptions", "ads", "sponsorship", "other"] as const;
export type MoneyKind = "cost" | "revenue";

/** One cost or revenue line for a product (shared by all its launches). */
export interface LedgerEntry {
  id: string;
  productId: string;
  userId: string;
  kind: MoneyKind;
  /** Minor units (cents) to keep sums exact. */
  amount: number;
  /** ISO 4217 code. */
  currency: string;
  category: string;
  note: string;
  /** Calendar date the money moved. */
  date: string;
  createdAt: string;
}

/** "Take my money": a non-binding pledge that measures how much people want it. */
export interface Pledge {
  slopId: string;
  userId: string;
  /** Minor units of USD. */
  amount: number;
  createdAt: string;
}

export const PLEDGE_PRESETS = [500, 1000, 2500] as const;
