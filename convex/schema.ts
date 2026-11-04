import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { EMBEDDING_DIMENSIONS } from "./lib/embeddings";

/**
 * Slopper's data. Convex gives every query live updates, so votes, the
 * daily race, feedback, pledges and notifications reach every open page as
 * they happen.
 */

export const integrationProviderValidator = v.union(
  v.literal("ga4"),
  v.literal("posthog"),
  v.literal("stripe"),
  v.literal("solana"),
);

/** Minor units by upper-case currency code. */
export const revenueValidator = v.record(v.string(), v.number());

export const snapshotValidator = v.object({
  mrr: v.optional(revenueValidator),
  subscribers: v.optional(v.number()),
  people30: v.optional(v.number()),
});

const crosspostMode = v.union(v.literal("post"), v.literal("amplify"), v.literal("off"));

/** Every network an account can be connected on (app/lib/networks.ts). */
export const socialProviderValidator = v.union(
  v.literal("x"),
  v.literal("linkedin"),
  v.literal("bluesky"),
  v.literal("threads"),
  v.literal("facebook"),
  v.literal("instagram"),
  v.literal("tiktok"),
  v.literal("youtube"),
  v.literal("mastodon"),
  v.literal("discord"),
  v.literal("telegram"),
  v.literal("reddit"),
);

/** Post stats as a network reports them; a network that doesn't count something leaves it out. */
export const socialMetricsValidator = v.object({
  views: v.optional(v.number()),
  likes: v.optional(v.number()),
  comments: v.optional(v.number()),
  shares: v.optional(v.number()),
  saves: v.optional(v.number()),
  reposts: v.optional(v.number()),
});

/** What the composer asks only when that network is picked (app/lib/networks.ts `NetworkOptions`). */
export const networkOptionsValidator = v.object({
  youtube: v.optional(
    v.object({
      title: v.string(),
      privacy: v.union(v.literal("public"), v.literal("unlisted"), v.literal("private")),
      madeForKids: v.boolean(),
    }),
  ),
  tiktok: v.optional(
    v.object({
      privacy: v.union(
        v.literal("PUBLIC_TO_EVERYONE"),
        v.literal("MUTUAL_FOLLOW_FRIENDS"),
        v.literal("FOLLOWER_OF_CREATOR"),
        v.literal("SELF_ONLY"),
        v.null(),
      ),
      allowComments: v.boolean(),
      allowDuet: v.boolean(),
      allowStitch: v.boolean(),
      brandedContent: v.boolean(),
      yourBrand: v.boolean(),
    }),
  ),
  instagram: v.optional(
    v.object({
      format: v.union(v.literal("feed"), v.literal("story")),
      /** Up to three usernames invited as collaborators on a feed post or Reel. */
      collaborators: v.optional(v.array(v.string())),
    }),
  ),
  /** The document's title on LinkedIn. */
  linkedin: v.optional(v.object({ documentTitle: v.string() })),
});

export const socialPostMediaValidator = v.object({
  mediaId: v.id("media"),
  /** A document is a PDF, posted as a LinkedIn document (a swipeable carousel). */
  kind: v.union(v.literal("image"), v.literal("video"), v.literal("document")),
  /** What a picture shows, for people who can't see it. */
  alt: v.optional(v.string()),
  /** The second of a video its cover is taken from (Instagram, TikTok). */
  coverAt: v.optional(v.number()),
  /** Seconds, for a video. */
  duration: v.optional(v.number()),
  width: v.optional(v.number()),
  height: v.optional(v.number()),
});

export const socialDeliveryStatusValidator = v.union(
  v.literal("queued"),
  v.literal("sending"),
  v.literal("processing"),
  v.literal("ok"),
  v.literal("error"),
  v.literal("skipped"),
  /** Taken down from the network from the studio. */
  v.literal("removed"),
);

export const socialActivityValidator = v.object({ at: v.number(), kind: v.string(), detail: v.string() });

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

/** A demo video linked on YouTube, Loom or Vimeo (see app/lib/video.ts). Uploaded promo videos are `video`. */
export const demoVideoValidator = v.object({
  provider: v.union(v.literal("youtube"), v.literal("loom"), v.literal("vimeo")),
  id: v.string(),
  vertical: v.boolean(),
});

export const featureValidator = v.object({ title: v.string(), body: v.string() });

export const crosspostResultValidator = v.object({
  accountId: v.string(),
  provider: socialProviderValidator,
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
  /** A moderator approved a held or flagged comment, or removed it. */
  v.object({
    type: v.literal("moderateComment"),
    slopId: v.id("slops"),
    authorId: v.id("users"),
    decision: v.union(v.literal("approve"), v.literal("remove")),
    /** Whether approving it trusted the author (convex/comments.ts). */
    trusted: v.boolean(),
  }),
  v.object({ type: v.literal("deleteReview"), slopId: v.id("slops"), authorId: v.id("users") }),
  /** Deleted everything analytics had on someone (the target is their username, or the id they had). */
  v.object({ type: v.literal("forgetPerson") }),
  /** Made, changed, turned on or off, or deleted a feature flag (the target is its key). */
  v.object({
    type: v.literal("flag"),
    change: v.union(
      v.literal("created"),
      v.literal("changed"),
      v.literal("on"),
      v.literal("off"),
      v.literal("deleted"),
    ),
  }),
  /** Made, changed, started, stopped or deleted a survey (the target is its key). */
  v.object({
    type: v.literal("survey"),
    change: v.union(
      v.literal("created"),
      v.literal("changed"),
      v.literal("started"),
      v.literal("stopped"),
      v.literal("deleted"),
    ),
  }),
  /** Made, changed, started, stopped or deleted an experiment (the target is its key). */
  v.object({
    type: v.literal("experiment"),
    change: v.union(
      v.literal("created"),
      v.literal("changed"),
      v.literal("started"),
      v.literal("stopped"),
      v.literal("deleted"),
    ),
  }),
);

/**
 * What the video check said about a trusted uploader's video: a verdict, or
 * "unchecked" when it couldn't run (convex/videos.ts).
 */
export const reviewExperienceValidator = v.union(v.literal("works"), v.literal("mixed"), v.literal("broken"));

/**
 * What the content check said about a review before it was saved. Blocked
 * reviews are never saved; "unchecked" means the check couldn't run.
 */
export const reviewCheckValidator = v.object({
  verdict: v.union(v.literal("ok"), v.literal("mature"), v.literal("unchecked")),
  reason: v.string(),
});

/**
 * What a comment's content check decided (convex/activity.ts). A comment is
 * shown only when it has an "ok" verdict; "unchecked" and "mature" wait for a
 * moderator. `source` says who said so: the model, a moderator, or the trust a
 * moderator granted the commenter.
 */
export const commentCheckValidator = v.object({
  verdict: v.union(v.literal("ok"), v.literal("mature"), v.literal("unchecked")),
  reason: v.string(),
  source: v.union(v.literal("check"), v.literal("moderator"), v.literal("trust")),
  checkedAt: v.number(),
});

/** What the app server sends when it saves a comment it checked. */
export const commentCheckInputValidator = v.object({
  verdict: v.union(v.literal("ok"), v.literal("mature"), v.literal("unchecked")),
  reason: v.string(),
});

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
  /** The name a publication (a PDF or EPUB) was uploaded with, shown on its slop. */
  fileName: v.optional(v.string()),
  /**
   * Set when no slop shows a B2 image any more. Only the app server holds the
   * bucket key, so it deletes the object, then the row (app/.server/media.ts).
   */
  orphanedAt: v.optional(v.number()),
  /**
   * False until a slop, update, review, scheduled launch or the slop's video
   * shows it (`ownedMedia`, `videos.set`). Uploads nothing ever attaches — an
   * abandoned form, or someone filling storage on purpose — are swept after a
   * grace period (`media.sweepUnattached`). Absent on media from before the
   * flag, which the sweep leaves alone.
   */
  attached: v.optional(v.boolean()),
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
    /**
     * When the person last proved it was them on this session: signing in
     * (with their second factor, when they have one) or confirming it again.
     * Sensitive actions ask again once it's older than 15 minutes.
     */
    verifiedAt: v.optional(v.number()),
    /** What the browser said it was, for the sessions list. */
    userAgent: v.optional(v.string()),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_user", ["userId"])
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
  )
    .index("by_orphaned", ["orphanedAt"])
    .index("by_attached", ["attached"]),

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
    /**
     * A publication the maker wrote (a book, zine, guide or paper) as one
     * PDF, read on the slop page. It's checked at upload like a screenshot,
     * and stands in for links: a slop needs one or the other.
     */
    publication: v.optional(v.id("media")),
    madeWith: v.array(v.string()),
    /** The product page: a linked demo video, what it does and who it's for. Absent on slops from before them. */
    demo: v.optional(v.union(demoVideoValidator, v.null())),
    features: v.optional(v.array(featureValidator)),
    audience: v.optional(v.string()),
    /** UTC date it went out (goals and streaks), the same as `raceDate`. */
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
    /**
     * The votes its race counts (`convex/race.ts`): cast on `raceDate`, by
     * people the race lets count. They stop moving when the day ends.
     * Server-side. Absent on slops from before them: their totals stand in.
     */
    raceUpvotes: v.optional(v.number()),
    raceDownvotes: v.optional(v.number()),
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
    /** Pending content check: whether a matching verdict may lift this temporary hide. */
    publishAfterCheck: v.optional(v.boolean()),
    /** The latest check. A moderator's approval alone never clears automatic posting. */
    check: v.optional(
      v.object({
        verdict: checkVerdictValidator,
        reason: v.string(),
        checkedAt: v.number(),
        source: v.optional(v.literal("moderator")),
      }),
    ),
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
   * trust, hiding, and deleting someone else's slop, comment or review. Admins read
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
    publication: v.optional(v.id("media")),
    madeWith: v.array(v.string()),
    /** The product page, carried onto the launch when it goes out. */
    demo: v.optional(v.union(demoVideoValidator, v.null())),
    features: v.optional(v.array(featureValidator)),
    audience: v.optional(v.string()),
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
    /** A completion lease; failures and crashed callers leave the release retryable. */
    claimedUntil: v.optional(v.number()),
    claimVersion: v.optional(v.number()),
  })
    .index("by_user_release", ["userId", "releaseAt"])
    .index("by_product", ["productId"]),

  /** Short-lived, server-only quota receipts; abandoned attempts remain charged. */
  updateReservations: defineTable({
    userId: v.id("users"),
    slopId: v.id("slops"),
    expiresAt: v.number(),
    /** Set atomically with the final write so a retry returns the same update. */
    updateId: v.union(v.id("updates"), v.null()),
  }).index("by_expiry", ["expiresAt"]),

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

  /**
   * Feedback and kudos on a slop. A new comment runs the content check
   * (app/.server/comments.ts); anything but "ok" waits in `hidden` for a
   * moderator, and so does a comment people flag. Comments from before the
   * check have no `check` and show as they always did.
   */
  comments: defineTable({
    slopId: v.id("slops"),
    userId: v.id("users"),
    kind: v.union(v.literal("feedback"), v.literal("kudos")),
    body: v.string(),
    /** Server-side: only whether it's shown reaches the page. */
    check: v.optional(commentCheckValidator),
    /** Held from the page until a moderator clears it. */
    hidden: v.optional(v.boolean()),
    /** Whether the maker was told it went up (it waits when the comment does). */
    notified: v.optional(v.boolean()),
  })
    .index("by_slop", ["slopId"])
    .index("by_hidden", ["hidden"]),

  /** People flagging comments, one row each (convex/comments.ts). */
  commentFlags: defineTable({
    commentId: v.id("comments"),
    reporterId: v.id("users"),
    reason: v.string(),
  })
    .index("by_comment", ["commentId"])
    .index("by_comment_reporter", ["commentId", "reporterId"])
    .index("by_reporter", ["reporterId"]),

  /**
   * Whose comments skip the content check and the hourly cap. A moderator
   * approving someone's held or flagged comment trusts them; there is no
   * revoke yet, so a row only ever says trusted (convex/comments.ts).
   */
  commentTrust: defineTable({
    userId: v.id("users"),
    trusted: v.boolean(),
    /** The moderator who trusted them, and when. */
    by: v.id("users"),
    at: v.number(),
  }).index("by_user", ["userId"]),

  /**
   * Reviews from people who tried a slop: how it went for them, in their
   * words, with screenshots. One per person per launch; writing again
   * replaces it. Each passes the content check before it's saved
   * (app/.server/reviews.ts), so none waits for a moderator.
   */
  reviews: defineTable({
    slopId: v.id("slops"),
    userId: v.id("users"),
    experience: reviewExperienceValidator,
    body: v.string(),
    /** Screenshots checked at upload, like a slop's (convex/media.ts). */
    images: v.array(v.id("media")),
    /** Server-side: only whether it's mature reaches a public shape. */
    check: reviewCheckValidator,
    editedAt: v.union(v.number(), v.null()),
  })
    .index("by_slop_user", ["slopId", "userId"])
    // Which of a reviewer's images reviews still show (`releaseMedia`).
    .index("by_user", ["userId"]),

  votes: defineTable({
    slopId: v.id("slops"),
    userId: v.id("users"),
    value: v.union(v.literal(1), v.literal(-1)),
    /**
     * UTC day the vote was cast (or last changed), for the daily allowance.
     * Absent on votes from before the allowance, which count on no day.
     */
    castOn: v.optional(v.string()),
    /**
     * Whether it counts in its slop's race (`countsInRace`). Absent on votes
     * from before that rule: they count when cast on the race day.
     */
    inRace: v.optional(v.boolean()),
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
    provider: socialProviderValidator,
    remoteId: v.string(),
    handle: v.string(),
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    /** AES-GCM sealed by the app server. Convex never sees plaintext. */
    sealedCredentials: v.string(),
    expiresAt: v.union(v.string(), v.null()),
    defaultMode: crosspostMode,
    /**
     * The brand this account speaks for ("Tiltmaze", "Me"), so the composer
     * can pick a brand's accounts on every network at once.
     */
    brand: v.optional(v.string()),
    /**
     * When set, this social account is shared with every member of the
     * organisation so teammates can post and repost with it in the studio.
     */
    organizationId: v.optional(v.id("organizations")),
    /** Why posting as it stopped working (a revoked or expired token); cleared by reconnecting. */
    broken: v.optional(v.string()),
    /** An X account with Premium: posts up to 25,000 characters. */
    longPosts: v.optional(v.boolean()),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["organizationId"])
    .index("by_user_remote", ["userId", "provider", "remoteId"]),

  /**
   * Organisation accounts: teams and studios that share connected social
   * accounts so any member can compose, schedule, and publish for the org.
   */
  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    ownerId: v.id("users"),
    avatarUrl: v.union(v.string(), v.null()),
    bio: v.string(),
    website: v.union(v.string(), v.null()),
  })
    .index("by_slug", ["slug"])
    .index("by_owner", ["ownerId"]),

  organizationMembers: defineTable({
    organizationId: v.id("organizations"),
    userId: v.id("users"),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("member")),
  })
    .index("by_org", ["organizationId"])
    .index("by_user", ["userId"])
    .index("by_org_user", ["organizationId", "userId"]),

  /**
   * Read-only connections that bring a product's traction onto its page
   * (app/lib/integrations.ts). One per provider per product, keyed by its
   * first launch like the ledger.
   */
  integrations: defineTable({
    productId: v.id("slops"),
    userId: v.id("users"),
    provider: integrationProviderValidator,
    /** Not secret: a property or project id, a wallet address, the signup event. */
    settings: v.record(v.string(), v.string()),
    /** An API key, AES-GCM sealed by the app server. Convex never sees plaintext. */
    sealedSecret: v.union(v.string(), v.null()),
    /** Show its numbers to everyone. The owner always sees them. */
    public: v.boolean(),
    status: v.union(v.literal("pending"), v.literal("ok"), v.literal("error")),
    error: v.union(v.string(), v.null()),
    syncedAt: v.union(v.number(), v.null()),
    /** Set while a sync runs, so page views don't start a second one. */
    syncingAt: v.union(v.number(), v.null()),
    /** Where an incremental source (a wallet) left off. */
    cursor: v.union(v.string(), v.null()),
    live: v.union(v.object({ people: v.number(), at: v.number() }), v.null()),
    snapshot: snapshotValidator,
  })
    .index("by_product", ["productId"])
    .index("by_user", ["userId"]),

  /** One source's numbers for one day. */
  metrics: defineTable({
    integrationId: v.id("integrations"),
    productId: v.id("slops"),
    date: v.string(),
    people: v.optional(v.number()),
    signups: v.optional(v.number()),
    revenue: v.optional(revenueValidator),
  })
    .index("by_integration_date", ["integrationId", "date"])
    .index("by_product_date", ["productId", "date"]),

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
      v.literal("review"),
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

  /**
   * How many slops use each "Made with" tag (app/lib/tags.ts), so the picker
   * can offer the most used first. `key` is the name in lower case; `name` is
   * how it's spelled on slops. Kept by `retag` (convex/lib/tags.ts).
   */
  madeWithTags: defineTable({
    key: v.string(),
    name: v.string(),
    uses: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_uses", ["uses"]),

  /**
   * A post written once in the studio (/studio) for several connected
   * accounts. Each account's copy is a `socialDeliveries` row, so one
   * network failing never holds up another, and a retry only resends what
   * failed. Checked before it's saved (app/.server/social/studio.ts).
   */
  socialPosts: defineTable({
    userId: v.id("users"),
    /** When posted using an organisation's shared accounts, members of that org can see it. */
    organizationId: v.optional(v.id("organizations")),
    /** The product it's about, when it's about one: its first launch. */
    productId: v.union(v.id("slops"), v.null()),
    text: v.string(),
    link: v.union(v.string(), v.null()),
    media: v.array(socialPostMediaValidator),
    /** Words written for one network instead of the shared ones, by provider. */
    overrides: v.record(v.string(), v.string()),
    options: networkOptionsValidator,
    /** When it goes out; null once it's been sent (or for "post now"). */
    scheduledAt: v.union(v.number(), v.null()),
    cancelled: v.optional(v.boolean()),
    /** Saved, not sent: nothing is checked or scheduled until it's posted. */
    draft: v.optional(v.boolean()),
    /** Its time came and its deliveries were handed out (so a repeat is made once). */
    released: v.optional(v.boolean()),
    /** More posts after the first, as a thread, on networks that thread (X, Bluesky, Threads). */
    thread: v.optional(v.array(v.string())),
    /** A comment posted under it right after, where the network takes comments. */
    firstComment: v.optional(v.string()),
    /** For its owner only. */
    note: v.optional(v.string()),
    tags: v.optional(v.array(v.string())),
    /** Goes out again every `everyDays`, `remaining` more times. */
    repeat: v.optional(v.object({ everyDays: v.number(), remaining: v.number() })),
    /** Minutes between one account's copy and the next. */
    staggerMinutes: v.optional(v.number()),
    /** Once a copy reaches `likes`, reply under it with `text` (thread networks). */
    plug: v.optional(v.object({ likes: v.number(), text: v.string() })),
    /** The link goes out as a Slopper short link per network, with UTM tags, so clicks are counted. */
    trackLinks: v.optional(v.boolean()),
    /** A YouTube custom thumbnail (a checked picture). */
    coverMediaId: v.optional(v.id("media")),
    /** An API caller's key: sending the same key again returns the same post. */
    idempotencyKey: v.optional(v.string()),
    source: v.optional(v.union(v.literal("web"), v.literal("api"), v.literal("rss"), v.literal("csv"))),
    /** Who did what to it, newest last, capped. */
    activity: v.optional(v.array(socialActivityValidator)),
  })
    .index("by_user", ["userId"])
    .index("by_org", ["organizationId"])
    .index("by_scheduled", ["scheduledAt"])
    .index("by_user_key", ["userId", "idempotencyKey"]),

  socialDeliveries: defineTable({
    postId: v.id("socialPosts"),
    userId: v.id("users"),
    accountId: v.id("accounts"),
    /** Copied from the account, so receipts survive a disconnect. */
    provider: socialProviderValidator,
    handle: v.string(),
    status: socialDeliveryStatusValidator,
    /** A sending or processing row belongs to one app caller until then. */
    leaseUntil: v.optional(v.number()),
    /** When a processing upload should be asked about again. */
    nextAttemptAt: v.optional(v.number()),
    /** The network's handle on an upload still processing (a container, a publish id). Not secret. */
    pending: v.optional(v.string()),
    attempts: v.number(),
    remoteId: v.optional(v.string()),
    url: v.optional(v.string()),
    message: v.optional(v.string()),
    /** An error where the network may have taken the post anyway: retrying could post it twice. */
    uncertain: v.optional(v.boolean()),
    sentAt: v.optional(v.number()),
    metrics: v.optional(socialMetricsValidator),
    metricsAt: v.optional(v.number()),
    /** When to read its stats again; absent once they've settled (a month on). */
    nextMetricsAt: v.optional(v.number()),
    /** Not sent before this (staggered accounts). */
    notBefore: v.optional(v.number()),
    /** Reposts another account's copy on the same network instead of posting its own. */
    repost: v.optional(v.boolean()),
    /** Bluesky's content id for the post, which replies and reposts need. */
    cid: v.optional(v.string()),
    /** Remote ids of the thread's later posts and the first comment, in order. */
    parts: v.optional(v.array(v.string())),
    /** Sent, but something after it didn't go (a thread stopped, the comment failed). */
    warning: v.optional(v.string()),
    /** The auto-plug reply went out. */
    plugged: v.optional(v.boolean()),
  })
    .index("by_post", ["postId"])
    .index("by_user", ["userId"])
    .index("by_account", ["accountId"])
    .index("by_next_attempt", ["nextAttemptAt"])
    .index("by_next_metrics", ["nextMetricsAt"])
    .index("by_lease", ["status", "leaseUntil"]),

  /** A person's studio settings: the posting queue, the pause switch, the calendar feed, the webhook. */
  socialSettings: defineTable({
    userId: v.id("users"),
    paused: v.optional(v.boolean()),
    /** Weekly queue times: day 0 (Sunday) to 6, minutes after midnight in the person's time zone. */
    slots: v.array(v.object({ day: v.number(), minute: v.number() })),
    /** The secret in the calendar feed's address. */
    calendarToken: v.optional(v.string()),
    /** Where post events are sent, signed with `secret`. */
    webhook: v.optional(
      v.object({
        url: v.string(),
        secret: v.string(),
        lastStatus: v.optional(v.string()),
        lastAt: v.optional(v.number()),
      }),
    ),
  })
    .index("by_user", ["userId"])
    .index("by_calendar_token", ["calendarToken"]),

  /** Reusable words: hashtag groups, signatures (one may add itself), templates and saved replies. */
  socialSnippets: defineTable({
    userId: v.id("users"),
    kind: v.union(v.literal("hashtags"), v.literal("signature"), v.literal("template"), v.literal("reply")),
    name: v.string(),
    text: v.string(),
    autoAdd: v.optional(v.boolean()),
  }).index("by_user", ["userId"]),

  /** How a brand sounds, for the writing assistant. Brands themselves are names on accounts. */
  socialBrands: defineTable({
    userId: v.id("users"),
    name: v.string(),
    voice: v.string(),
  }).index("by_user_name", ["userId", "name"]),

  /** Short links a studio post went out with, one per network, counting clicks (`/go/:code`). */
  socialLinks: defineTable({
    code: v.string(),
    userId: v.id("users"),
    postId: v.id("socialPosts"),
    provider: socialProviderValidator,
    /** Where it goes, UTM tags included. */
    url: v.string(),
    clicks: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_post", ["postId"]),

  /** A preview link anyone can open to see a post before it goes out, and say what they think. */
  socialReviews: defineTable({
    postId: v.id("socialPosts"),
    userId: v.id("users"),
    token: v.string(),
    expiresAt: v.number(),
    revoked: v.optional(v.boolean()),
    feedback: v.array(
      v.object({
        at: v.number(),
        name: v.string(),
        verdict: v.union(v.literal("approve"), v.literal("changes")),
        note: v.string(),
      }),
    ),
  })
    .index("by_token", ["token"])
    .index("by_post", ["postId"]),

  /** RSS or Atom feeds whose new items become studio posts. */
  socialFeeds: defineTable({
    userId: v.id("users"),
    url: v.string(),
    accountIds: v.array(v.id("accounts")),
    /** With {title} and {link}. */
    template: v.string(),
    mode: v.union(v.literal("now"), v.literal("queue")),
    active: v.boolean(),
    /** Item ids already posted (or there when the feed was added), newest first, capped. */
    seen: v.array(v.string()),
    checkedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  })
    .index("by_user", ["userId"])
    .index("by_checked", ["active", "checkedAt"]),

  /**
   * Two-factor sign-in (app/.server/auth/twoFactor.ts). Anyone with a
   * confirmed authenticator app or a passkey must use one after signing in
   * with GitHub, Google, X, LinkedIn or Facebook.
   */
  totpFactors: defineTable({
    userId: v.id("users"),
    /** The shared secret, sealed by the app server. */
    sealedSecret: v.string(),
    /** Unconfirmed until a code from the app matches once. */
    confirmed: v.boolean(),
    /** The last 30-second step a code was used for, so a code works once. */
    lastStep: v.optional(v.number()),
  }).index("by_user", ["userId"]),

  passkeys: defineTable({
    userId: v.id("users"),
    /** base64url, as WebAuthn names it. */
    credentialId: v.string(),
    /** The COSE public key, base64url. Not secret. */
    publicKey: v.string(),
    counter: v.number(),
    transports: v.array(v.string()),
    name: v.string(),
    lastUsedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_credential", ["credentialId"]),

  /** One-time codes for when the phone and passkeys are gone, stored hashed. */
  recoveryCodes: defineTable({
    userId: v.id("users"),
    codes: v.array(v.object({ hash: v.string(), usedAt: v.optional(v.number()) })),
  }).index("by_user", ["userId"]),

  /**
   * A second-factor step in progress: after OAuth, before the session starts
   * ("login"), confirming again before a sensitive action ("stepup"), or a
   * passkey being added ("register"). The browser holds the token, Convex its hash.
   */
  authChallenges: defineTable({
    tokenHash: v.string(),
    kind: v.union(v.literal("login"), v.literal("stepup"), v.literal("register")),
    userId: v.id("users"),
    /** The WebAuthn challenge, once one was asked for. */
    challenge: v.optional(v.string()),
    returnTo: v.string(),
    attempts: v.number(),
    expiresAt: v.number(),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_expiry", ["expiresAt"]),

  /** What happened to a person's sign-in security, for them to read at /settings/security. */
  securityEvents: defineTable({
    userId: v.id("users"),
    kind: v.string(),
    detail: v.string(),
  }).index("by_user", ["userId"]),
});
