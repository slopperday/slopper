import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { EMBEDDING_DIMENSIONS } from "./lib/embeddings";

/**
 * Slopper's data. Convex gives every query live updates, so votes, the
 * daily race, feedback, pledges and notifications reach every open page as
 * they happen.
 */

const crosspostMode = v.union(v.literal("post"), v.literal("amplify"), v.literal("off"));

const linkKindValidator = v.union(
  v.literal("website"),
  v.literal("app_store"),
  v.literal("testflight"),
  v.literal("play_store"),
  v.literal("play_beta"),
  v.literal("source"),
  v.literal("other"),
);

export const linkValidator = v.object({ kind: linkKindValidator, url: v.string() });

/**
 * A link on an update, with the card read from its page when the maker
 * asked for one (app/.server/preview.ts). The card's image was checked and
 * stored like any upload.
 */
export const updateLinkValidator = v.object({
  kind: linkKindValidator,
  url: v.string(),
  preview: v.union(
    v.object({
      title: v.string(),
      description: v.string(),
      siteName: v.string(),
      imageId: v.union(v.id("media"), v.null()),
    }),
    v.null(),
  ),
});

/** What only some kinds of update carry (see `UpdateDetails` in app/lib/model.ts). */
export const updateDetailsValidator = v.union(
  v.object({ kind: v.literal("feature"), name: v.string() }),
  v.object({
    kind: v.literal("field"),
    outcome: v.union(v.literal("worked"), v.literal("mixed"), v.literal("broke")),
    who: v.union(v.string(), v.null()),
  }),
);

export const crosspostResultValidator = v.object({
  accountId: v.string(),
  provider: v.union(v.literal("x"), v.literal("linkedin"), v.literal("bluesky")),
  handle: v.string(),
  mode: v.union(v.literal("post"), v.literal("amplify")),
  status: v.union(v.literal("ok"), v.literal("error"), v.literal("skipped")),
  url: v.union(v.string(), v.null()),
  message: v.union(v.string(), v.null()),
  at: v.string(),
});

export const updateKindValidator = v.union(
  v.literal("launch"),
  v.literal("update"),
  v.literal("feature"),
  v.literal("field"),
  v.literal("repromote"),
  v.literal("slopcessful"),
);

/** Why an OAuth flow started (see app/.server/auth/oauth.ts). */
export const oauthIntentValidator = v.union(v.literal("login"), v.literal("link"), v.literal("connect"));

/** Outcome of the automated content check (see app/.server/moderation.ts). */
export const checkVerdictValidator = v.union(v.literal("ok"), v.literal("mature"), v.literal("blocked"));

/**
 * What the check said about an image when it was uploaded. Blocked images are
 * never stored; "unchecked" means the check couldn't run, so the launch-time
 * check is the first to read it.
 */
export const mediaCheckValidator = v.object({
  verdict: v.union(v.literal("ok"), v.literal("mature"), v.literal("unchecked")),
  reason: v.string(),
});

/**
 * The moderation team. What each role may do is in convex/lib/permissions.ts.
 * ADMIN_IDENTITIES makes people admins too (see convex/team.ts).
 */
export const staffRoleValidator = v.union(v.literal("admin"), v.literal("moderator"));

/** A way into an account: a sign-in provider ("github", "x"…) and that provider's id for the person. */
export const signInIdentityValidator = v.object({ provider: v.string(), providerId: v.string() });

/** A moderator's call on a flagged slop (convex/moderation.ts). */
export const flagDecisionValidator = v.union(v.literal("fine"), v.literal("nsfw"), v.literal("hide"));

/** One use of a staff power, for the staff log (convex/lib/staffLog.ts). */
export const staffActionValidator = v.union(
  v.object({ type: v.literal("role"), userId: v.id("users"), role: v.union(staffRoleValidator, v.null()) }),
  /** Made an admin on signing in with an account in ADMIN_IDENTITIES. */
  v.object({ type: v.literal("listedAdmin"), userId: v.id("users") }),
  v.object({ type: v.literal("flags"), slopId: v.id("slops"), decision: flagDecisionValidator }),
  v.object({ type: v.literal("video"), slopId: v.id("slops"), approved: v.boolean() }),
  v.object({ type: v.literal("takeDown"), slopId: v.id("slops") }),
  v.object({ type: v.literal("trust"), userId: v.id("users"), trusted: v.boolean() }),
  v.object({ type: v.literal("hidden"), slopId: v.id("slops"), hidden: v.boolean() }),
  v.object({ type: v.literal("deleteSlop"), slopId: v.id("slops"), ownerId: v.id("users") }),
  v.object({ type: v.literal("deleteComment"), slopId: v.id("slops"), authorId: v.id("users") }),
);

/**
 * What the video check said about a trusted uploader's video: a verdict, or
 * "unchecked" when it couldn't run (convex/videos.ts).
 */
export const videoVerdictValidator = v.union(
  v.literal("ok"),
  v.literal("mature"),
  v.literal("blocked"),
  v.literal("unchecked"),
);

/** Where an image's bytes live. Media rows from before B2 have no `backend`: they're in Convex. */
export const mediaLocationValidator = v.union(
  v.object({ backend: v.literal("convex"), storageId: v.id("_storage") }),
  v.object({ backend: v.literal("b2"), key: v.string() }),
);

const mediaFields = {
  ownerId: v.id("users"),
  contentType: v.string(),
  size: v.number(),
  /** Absent on images uploaded before the upload check existed. */
  check: v.optional(mediaCheckValidator),
  /**
   * Set when no slop shows a B2 image any more. Only the app server holds the
   * bucket key, so it deletes the object, then the row (app/.server/media.ts).
   */
  orphanedAt: v.optional(v.number()),
};

export default defineSchema({
  users: defineTable({
    username: v.string(),
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    bio: v.string(),
    website: v.union(v.string(), v.null()),
    /** IANA zone. Midnight here ends this person's day. */
    timeZone: v.string(),
    showNsfw: v.boolean(),
    /**
     * A sign-in provider's verified address, kept only for the daily
     * digest. Server-side: it never goes into a public shape.
     */
    email: v.optional(v.string()),
    /** The daily digest; on unless turned off. */
    emailDigest: v.optional(v.boolean()),
    /** Unguessable, for the one-click unsubscribe link in every digest. */
    emailToken: v.optional(v.string()),
    /** When the next digest is due (9am local). Absent: none is. */
    nextDigestAt: v.optional(v.number()),
    /** Notifications after this went into no digest yet. */
    digestSentAt: v.optional(v.number()),
    /** On the moderation team. Server-side: it never goes into a public shape. */
    role: v.optional(staffRoleValidator),
  })
    .index("by_username", ["username"])
    .index("by_role", ["role"])
    .index("by_next_digest", ["nextDigestAt"])
    .index("by_email_token", ["emailToken"]),

  /** Ways into an account: one per provider ("github", "x", "dev"…), at least one each. */
  identities: defineTable({
    provider: v.string(),
    providerId: v.string(),
    userId: v.id("users"),
  })
    .index("by_provider_id", ["provider", "providerId"])
    .index("by_user_provider", ["userId", "provider"]),

  /** Browser sessions. Only a hash of the cookie value is stored. */
  sessions: defineTable({
    tokenHash: v.string(),
    userId: v.id("users"),
    expiresAt: v.number(),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_expiry", ["expiresAt"]),

  /** In-flight OAuth authorizations, keyed by `state`. */
  oauthStates: defineTable({
    state: v.string(),
    provider: v.string(),
    intent: oauthIntentValidator,
    codeVerifier: v.string(),
    userId: v.union(v.id("users"), v.null()),
    returnTo: v.string(),
    expiresAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_expiry", ["expiresAt"]),

  goals: defineTable({
    userId: v.id("users"),
    title: v.string(),
    target: v.number(),
    days: v.number(),
    startDate: v.string(),
    /** Last day of the goal, for finding open goals by index. */
    endDate: v.string(),
    abandonedAt: v.union(v.number(), v.null()),
  })
    .index("by_user", ["userId"])
    .index("by_end", ["endDate"]),

  /** Screenshots, in Convex file storage or a Backblaze B2 bucket. */
  media: defineTable(
    v.union(
      v.object({ ...mediaFields, backend: v.optional(v.literal("convex")), storageId: v.id("_storage") }),
      v.object({ ...mediaFields, backend: v.literal("b2"), key: v.string() }),
    ),
  ).index("by_orphaned", ["orphanedAt"]),

  /** One launch. Later launches of a product point at its first via `productId`. */
  slops: defineTable({
    userId: v.id("users"),
    productId: v.union(v.id("slops"), v.null()),
    launchLabel: v.union(v.string(), v.null()),
    slug: v.string(),
    name: v.string(),
    tagline: v.string(),
    description: v.string(),
    category: v.string(),
    nsfw: v.boolean(),
    links: v.array(linkValidator),
    screenshots: v.array(v.id("media")),
    /**
     * One promo video. The content check can't watch video, so it only plays
     * for everyone once a moderator approves it (convex/videos.ts).
     */
    video: v.optional(v.object({ mediaId: v.id("media"), approvedAt: v.union(v.number(), v.null()) })),
    madeWith: v.array(v.string()),
    /** Calendar date in the owner's zone (goal accounting). */
    launchDate: v.string(),
    /** UTC calendar date (slop of the day race). */
    raceDate: v.string(),
    goalId: v.union(v.id("goals"), v.null()),
    goalDay: v.union(v.number(), v.null()),
    goalLength: v.union(v.number(), v.null()),
    number: v.number(),
    upvotes: v.number(),
    /** Never returned by public queries. */
    downvotes: v.number(),
    commentCount: v.number(),
    updateCount: v.number(),
    fieldTests: v.number(),
    backers: v.number(),
    pledged: v.number(),
    lastActivityAt: v.number(),
    slopOfTheDay: v.union(v.string(), v.null()),
    slopcessfulAt: v.union(v.number(), v.null()),
    slopcessfulNote: v.union(v.string(), v.null()),
    crosspost: v.record(v.string(), crosspostMode),
    /** On a product's first launch: show its money publicly. */
    moneyPublic: v.boolean(),
    hidden: v.boolean(),
    /** The latest automated content check; absent until one has run. */
    check: v.optional(v.object({ verdict: checkVerdictValidator, reason: v.string(), checkedAt: v.number() })),
    /** Its vector for search by meaning (convex/search.ts); absent until one is made. */
    embeddingId: v.optional(v.id("slopEmbeddings")),
  })
    .index("by_user", ["userId"])
    .index("by_user_slug", ["userId", "slug"])
    .index("by_category", ["category"])
    .index("by_race_date", ["raceDate"])
    .index("by_product", ["productId"])
    .index("by_slopcessful", ["slopcessfulAt"])
    .index("by_embedding", ["embeddingId"])
    // Search by words (convex/search.ts): one index per field, so each ranks on its own.
    .searchIndex("search_name", { searchField: "name", filterFields: ["hidden", "category"] })
    .searchIndex("search_tagline", { searchField: "tagline", filterFields: ["hidden", "category"] })
    .searchIndex("search_description", { searchField: "description", filterFields: ["hidden", "category"] }),

  /**
   * Vectors for search by meaning, one per slop (`slops.embeddingId`). They
   * live apart from slops so reading a slop never reads 1,536 numbers.
   */
  slopEmbeddings: defineTable({
    /** The slop's category, to filter by. It's part of the embedded text, so it never trails it. */
    category: v.string(),
    /** What was embedded (app/lib/search.ts `embeddingText`), to skip edits that don't change it. */
    text: v.string(),
    embedding: v.array(v.float64()),
  }).vectorIndex("by_embedding", {
    vectorField: "embedding",
    dimensions: EMBEDDING_DIMENSIONS,
    filterFields: ["category"],
  }),

  /** Videos waiting for a moderator, oldest first (convex/videos.ts). */
  videoReviews: defineTable({
    slopId: v.id("slops"),
    mediaId: v.id("media"),
  }).index("by_slop", ["slopId"]),

  /**
   * Whose promo videos are checked automatically. A moderator approving
   * someone's video trusts them; revoking keeps the row, so later approvals
   * don't trust them again until a moderator does (convex/videos.ts).
   */
  videoTrust: defineTable({
    userId: v.id("users"),
    trusted: v.boolean(),
    /** The moderator who last trusted or revoked them, and when. */
    by: v.id("users"),
    at: v.number(),
  }).index("by_user", ["userId"]),

  /**
   * Every automatic decision on a trusted uploader's video, for moderators at
   * /mod. Server-side only: none of it reaches a public shape.
   */
  videoChecks: defineTable({
    slopId: v.id("slops"),
    mediaId: v.id("media"),
    ownerId: v.id("users"),
    verdict: videoVerdictValidator,
    reason: v.string(),
    /** The model that was asked and the OpenRouter provider tried first; null when no check is configured. */
    checker: v.union(v.object({ model: v.string(), provider: v.string() }), v.null()),
    /** Live when the check passed; anything else left it in the queue. */
    outcome: v.union(v.literal("live"), v.literal("queued")),
  }).index("by_slop", ["slopId"]),

  /**
   * Every use of a staff power: role changes, queue decisions, takedowns,
   * trust, hiding, and deleting someone else's slop or comment. Admins read
   * it at /mod/team. Server-side only: none of it reaches a public shape.
   */
  staffActions: defineTable({
    actorId: v.id("users"),
    action: staffActionValidator,
    /** What it was done to, named as it was then: a slop's name or "@username". */
    target: v.string(),
  }),

  /**
   * Launches waiting to go out (see app/lib/schedule.ts). Nobody but the
   * owner sees one until `releaseAt`, when it becomes a slop like any other.
   */
  scheduledLaunches: defineTable({
    userId: v.id("users"),
    releaseAt: v.number(),
    name: v.string(),
    tagline: v.string(),
    description: v.string(),
    category: v.string(),
    links: v.array(linkValidator),
    screenshots: v.array(v.id("media")),
    madeWith: v.array(v.string()),
    launchNote: v.string(),
    /** For another launch of a product: its first launch. */
    productId: v.union(v.id("slops"), v.null()),
    launchLabel: v.union(v.string(), v.null()),
    autopost: v.boolean(),
    /**
     * Set when it goes out, until the app server has run the content check
     * and auto-posted it (`schedule.claim`), which deletes the row.
     */
    released: v.optional(v.object({ slopId: v.id("slops"), updateId: v.id("updates") })),
  })
    .index("by_user_release", ["userId", "releaseAt"])
    .index("by_product", ["productId"]),

  updates: defineTable({
    slopId: v.id("slops"),
    userId: v.id("users"),
    kind: updateKindValidator,
    body: v.string(),
    crossposts: v.array(crosspostResultValidator),
    /** What shipped, like "v1.3". The fields below are absent on updates from before they existed. */
    version: v.optional(v.union(v.string(), v.null())),
    /** Images checked at upload, like screenshots (convex/media.ts). */
    images: v.optional(v.array(v.id("media"))),
    links: v.optional(v.array(updateLinkValidator)),
    details: v.optional(v.union(updateDetailsValidator, v.null())),
  })
    .index("by_slop", ["slopId"])
    // Which of an owner's images updates still show (`releaseMedia`).
    .index("by_user", ["userId"]),

  comments: defineTable({
    slopId: v.id("slops"),
    userId: v.id("users"),
    kind: v.union(v.literal("feedback"), v.literal("kudos")),
    body: v.string(),
  }).index("by_slop", ["slopId"]),

  votes: defineTable({
    slopId: v.id("slops"),
    userId: v.id("users"),
    value: v.union(v.literal(1), v.literal(-1)),
    /**
     * UTC day the vote was cast (or last changed), for the daily allowance.
     * Absent on votes from before the allowance, which count on no day.
     */
    castOn: v.optional(v.string()),
  })
    .index("by_slop_user", ["slopId", "userId"])
    .index("by_user_cast_on", ["userId", "castOn"]),

  pledges: defineTable({
    slopId: v.id("slops"),
    userId: v.id("users"),
    /** USD cents. Non-binding. */
    amount: v.number(),
  }).index("by_slop_user", ["slopId", "userId"]),

  /** Costs and revenue of a product (keyed by its first launch). */
  ledger: defineTable({
    productId: v.id("slops"),
    userId: v.id("users"),
    kind: v.union(v.literal("cost"), v.literal("revenue")),
    amount: v.number(),
    currency: v.string(),
    category: v.string(),
    note: v.string(),
    date: v.string(),
  }).index("by_product", ["productId"]),

  accounts: defineTable({
    userId: v.id("users"),
    provider: v.union(v.literal("x"), v.literal("linkedin"), v.literal("bluesky")),
    remoteId: v.string(),
    handle: v.string(),
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    /** AES-GCM sealed by the app server. Convex never sees plaintext. */
    sealedCredentials: v.string(),
    expiresAt: v.union(v.string(), v.null()),
    defaultMode: crosspostMode,
  })
    .index("by_user", ["userId"])
    .index("by_user_remote", ["userId", "provider", "remoteId"]),

  apiTokens: defineTable({
    userId: v.id("users"),
    name: v.string(),
    preview: v.string(),
    hash: v.string(),
    lastUsedAt: v.union(v.number(), v.null()),
  })
    .index("by_hash", ["hash"])
    .index("by_user", ["userId"]),

  /**
   * `slopper login` without a token: the CLI holds the device code (only its
   * hash is here), the person approves the user code at /cli while signed in,
   * and the CLI collects a new API token once. See convex/cliLogins.ts.
   */
  cliLogins: defineTable({
    deviceCodeHash: v.string(),
    userCode: v.string(),
    /** The API token's name, like "slopper CLI on studio". */
    name: v.string(),
    expiresAt: v.number(),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("denied"), v.literal("used")),
    userId: v.union(v.id("users"), v.null()),
  })
    .index("by_device_code", ["deviceCodeHash"])
    .index("by_user_code", ["userCode"])
    .index("by_expiry", ["expiresAt"]),

  dailyWinners: defineTable({
    date: v.string(),
    slopId: v.union(v.id("slops"), v.null()),
  }).index("by_date", ["date"]),

  notifications: defineTable({
    userId: v.id("users"),
    kind: v.union(
      v.literal("upvote"),
      v.literal("feedback"),
      v.literal("kudos"),
      v.literal("pledge"),
      v.literal("slop_of_the_day"),
    ),
    slopId: v.id("slops"),
    actorId: v.union(v.id("users"), v.null()),
    amount: v.union(v.number(), v.null()),
    readAt: v.union(v.number(), v.null()),
  }).index("by_user_read", ["userId", "readAt"]),

  /** Browsers that asked for notifications: one Web Push subscription each. */
  pushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    /** The browser's keys, base64url, to encrypt each message for it. */
    p256dh: v.string(),
    auth: v.string(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),

  /** Open flags on a slop, cleared when a moderator decides. */
  reports: defineTable({
    slopId: v.id("slops"),
    /** Null when the automated content check raised it. */
    reporterId: v.union(v.id("users"), v.null()),
    reason: v.string(),
  })
    .index("by_slop", ["slopId"])
    .index("by_slop_reporter", ["slopId", "reporterId"]),

  rateLimits: defineTable({
    key: v.string(),
    window: v.number(),
    count: v.number(),
  }).index("by_key_window", ["key", "window"]),

  counters: defineTable({
    name: v.string(),
    value: v.number(),
  }).index("by_name", ["name"]),
});
