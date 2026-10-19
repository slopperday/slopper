/**
 * Shared vocabulary for the app and the Convex functions: categories, link
 * kinds, limits and small shared types. Stored records are Convex documents
 * (see `convex/schema.ts`).
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

/** The real categories among `ids`, once each, in CATEGORIES order. */
export function categoryIds(ids: Iterable<string>): CategoryId[] {
  const wanted = new Set(ids);
  return CATEGORIES.filter((category) => wanted.has(category.id)).map((category) => category.id);
}

/**
 * The categories a list should be narrowed to: none when nothing is picked,
 * and none when everything is, since every slop is in one of them.
 */
export function categoryFilter(ids: Iterable<string>): CategoryId[] {
  const picked = categoryIds(ids);
  return picked.length === CATEGORIES.length ? [] : picked;
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

/** One thing a slop does, for its page. */
export interface SlopFeature {
  title: string;
  body: string;
}

/**
 * OAuth providers people sign in with, in the order the login page offers
 * them. X and LinkedIn also connect accounts for auto-posting. Instagram has
 * no consumer sign-in any more (Instagram Login is for professional
 * accounts), so Facebook stands in for Meta.
 */
export const OAUTH_PROVIDERS = ["github", "google", "x", "linkedin", "facebook"] as const;
export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number];

export const OAUTH_LABELS: Record<OAuthProviderId, string> = {
  github: "GitHub",
  google: "Google",
  x: "X",
  linkedin: "LinkedIn",
  facebook: "Facebook",
};

export function isOAuthProvider(value: string): value is OAuthProviderId {
  return (OAUTH_PROVIDERS as readonly string[]).includes(value);
}

/** Every way into an account: the OAuth providers, plus the local dev login. */
export type LoginProvider = OAuthProviderId | "dev";

export type CrosspostMode = "post" | "amplify" | "off";

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

/** How a field test went, as the maker tells it. */
export const FIELD_OUTCOMES = {
  worked: { label: "Worked" },
  mixed: { label: "Mixed" },
  broke: { label: "Broke" },
} as const;

export type FieldOutcome = keyof typeof FIELD_OUTCOMES;

export function isFieldOutcome(value: string): value is FieldOutcome {
  return Object.hasOwn(FIELD_OUTCOMES, value);
}

/**
 * What only some kinds of update carry: the name of the feature that
 * shipped, or how a field test went and who tried it.
 */
export type UpdateDetails =
  | { kind: "feature"; name: string }
  | { kind: "field"; outcome: FieldOutcome; who: string | null };

/** A card read from the page an update links to. Only shown when the maker asks for one. */
export interface LinkPreview {
  title: string;
  description: string;
  siteName: string;
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

export type CommentKind = "feedback" | "kudos";

/** How a slop worked for someone who tried it: the headline of their review. */
export const REVIEW_EXPERIENCES = {
  works: { label: "Works for me" },
  mixed: { label: "Mixed" },
  broken: { label: "Broken for me" },
} as const;

export type ReviewExperience = keyof typeof REVIEW_EXPERIENCES;

export function isReviewExperience(value: string): value is ReviewExperience {
  return Object.hasOwn(REVIEW_EXPERIENCES, value);
}

export const LIMITS = {
  nameLength: 60,
  taglineLength: 120,
  descriptionLength: 5000,
  updateLength: 2000,
  /** What an update carries besides its text. */
  updateImages: 4,
  updateLinks: 3,
  versionLength: 24,
  featureNameLength: 60,
  fieldWhoLength: 120,
  commentLength: 1000,
  /** A review: what it is, how it went, what broke. Up to 4 screenshots. */
  reviewLength: 2000,
  reviewImages: 4,
  bioLength: 280,
  launchLabelLength: 40,
  ledgerNoteLength: 120,
  /** $10,000 in cents: a pledge, not a wire transfer. */
  maxPledge: 1_000_000,
  links: 6,
  screenshots: 6,
  madeWith: 8,
  madeWithLength: 32,
  /** What it does, shown on its page: a short title and one line each. */
  features: 6,
  featureTitleLength: 40,
  featureBodyLength: 160,
  audienceLength: 160,
  /**
   * Room for a sharp 2400px screenshot. Netlify Functions take 6 MB requests
   * and base64-encode binary ones, so an upload has about 4.5 MB to work with.
   */
  mediaBytes: 4 * 1024 * 1024,
  /** Under Netlify's request cap, like images: a 20 s 1080p promo at CRF 23 is about 2 MB. */
  videoBytes: 4 * 1024 * 1024,
  goalDays: 365,
  /** Launches waiting to go out at once, and how far ahead one can be set. */
  scheduled: 30,
  scheduleDays: 100,
  /**
   * Votes (up or private down) each person can cast per UTC day, the race's
   * day. Taking one back today returns it.
   */
  votesPerDay: 5,
  /** How old an account must be before its votes count in the race (they always count on the slop). */
  raceVoterAge: 24 * 60 * 60 * 1000,
} as const;

/** Where people reach a human: privacy requests, account deletion, appeals. */
export const CONTACT_EMAIL = "hello@slopper.day";

export type FlashTone = "info" | "success" | "error";

export interface Flash {
  tone: FlashTone;
  message: string;
}

export const COST_CATEGORIES = ["domain", "hosting", "ai", "tools", "design", "marketing", "other"] as const;
export const REVENUE_CATEGORIES = ["sales", "subscriptions", "ads", "sponsorship", "other"] as const;
export type MoneyKind = "cost" | "revenue";

/** "Take my money" preset amounts, in USD cents. */
export const PLEDGE_PRESETS = [500, 1000, 2500] as const;

/** Flags from this many different people blur a slop until a moderator looks. */
export const FLAGS_TO_BLUR = 3;

/** Why someone flags a slop. The label is stored with the flag. */
export const FLAG_REASONS = [
  "Sexual or adult content",
  "Gore or violence",
  "Hate or harassment",
  "Spam, scam or malware",
  "Something else",
] as const;
