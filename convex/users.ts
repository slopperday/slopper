import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { captureFor } from "./analytics";
import { readerFor, requireServer } from "./lib/auth";
import { firstEmail, nextDigestAt } from "./lib/digest";
import { isHidden, publicUser, toCards } from "./lib/shape";
import { queuedDays } from "./schedule";
import { currentStreak, isValidTimeZone, utcDate } from "../app/lib/dates";
import { goalProgress, type Launch } from "../app/lib/goal";
import { LIMITS } from "../app/lib/model";
import { normalizeUsername, usernameProblem } from "../app/lib/username";

async function usernameTaken(ctx: MutationCtx, username: string): Promise<boolean> {
  const existing = await ctx.db
    .query("users")
    .withIndex("by_username", (q) => q.eq("username", username))
    .first();
  return existing !== null;
}

async function freeUsername(ctx: MutationCtx, preferred: string): Promise<string> {
  const base = normalizeUsername(preferred) || "slopper";
  for (let i = 1; i < 50; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, 26)}-${i}`;
    if (!usernameProblem(candidate) && !(await usernameTaken(ctx, candidate))) return candidate;
  }
  return `slopper-${Date.now().toString(36)}`;
}

/** Returns the user for a login identity, creating one on first sign-in. */
export const upsertFromIdentity = mutation({
  args: {
    provider: v.string(),
    providerId: v.string(),
    preferredUsername: v.string(),
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    bio: v.optional(v.string()),
    website: v.optional(v.union(v.string(), v.null())),
    timeZone: v.string(),
    /** Verified by the provider, or null. Kept only when the account has none yet. */
    email: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { email, ...args }): Promise<{ userId: Id<"users">; created: boolean }> => {
    await requireServer(ctx);
    const identity = await ctx.db
      .query("identities")
      .withIndex("by_provider_id", (q) => q.eq("provider", args.provider).eq("providerId", args.providerId))
      .unique();
    const existing = identity ? await ctx.db.get(identity.userId) : null;
    if (existing) {
      if (email && !existing.email) await ctx.db.patch(existing._id, firstEmail(email, existing.timeZone, Date.now()));
      return { userId: existing._id, created: false };
    }

    const username = await freeUsername(ctx, args.preferredUsername);
    const timeZone = isValidTimeZone(args.timeZone) ? args.timeZone : "UTC";
    const userId = await ctx.db.insert("users", {
      username,
      displayName: args.displayName.slice(0, 60) || username,
      avatarUrl: args.avatarUrl,
      bio: (args.bio ?? "").slice(0, LIMITS.bioLength),
      website: args.website ?? null,
      timeZone,
      showNsfw: false,
      ...(email ? firstEmail(email, timeZone, Date.now()) : {}),
    });
    if (identity) await ctx.db.patch(identity._id, { userId });
    else await ctx.db.insert("identities", { provider: args.provider, providerId: args.providerId, userId });
    await captureFor(ctx, userId, { name: "signed up", properties: { provider: args.provider } });
    return { userId, created: true };
  },
});

async function identitiesOf(ctx: QueryCtx, userId: Id<"users">): Promise<Doc<"identities">[]> {
  return await ctx.db
    .query("identities")
    .withIndex("by_user_provider", (q) => q.eq("userId", userId))
    .collect();
}

/** The providers that sign in to an account, one identity each. */
export const identities = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<string[]> => {
    await requireServer(ctx);
    return (await identitiesOf(ctx, userId)).map((row) => row.provider);
  },
});

export type LinkIdentityResult =
  | { ok: true; alreadyLinked: boolean }
  /**
   * `other_account`: that identity already signs in to someone else.
   * `provider_linked`: this account already has a different one from the same provider.
   */
  | { ok: false; reason: "other_account" | "provider_linked" };

/** Adds a sign-in method to an account, so signing in with it lands there. */
export const linkIdentity = mutation({
  args: {
    userId: v.id("users"),
    provider: v.string(),
    providerId: v.string(),
    email: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, { userId, provider, providerId, email }): Promise<LinkIdentityResult> => {
    await requireServer(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("Account not found.");
    const existing = await ctx.db
      .query("identities")
      .withIndex("by_provider_id", (q) => q.eq("provider", provider).eq("providerId", providerId))
      .unique();
    if (existing?.userId === userId) return { ok: true, alreadyLinked: true };
    // Never move an identity off a live account: that would take it over.
    if (existing && (await ctx.db.get(existing.userId))) return { ok: false, reason: "other_account" };
    const sameProvider = await ctx.db
      .query("identities")
      .withIndex("by_user_provider", (q) => q.eq("userId", userId).eq("provider", provider))
      .first();
    if (sameProvider) return { ok: false, reason: "provider_linked" };

    // An identity whose account is gone is free to claim.
    if (existing) await ctx.db.patch(existing._id, { userId });
    else await ctx.db.insert("identities", { provider, providerId, userId });
    if (email && !user.email) await ctx.db.patch(userId, firstEmail(email, user.timeZone, Date.now()));
    return { ok: true, alreadyLinked: false };
  },
});

export type UnlinkIdentityResult = { ok: true } | { ok: false; reason: "not_linked" | "last_method" };

/** Removes a sign-in method. The last one stays, so nobody locks themselves out. */
export const unlinkIdentity = mutation({
  args: { userId: v.id("users"), provider: v.string() },
  handler: async (ctx, { userId, provider }): Promise<UnlinkIdentityResult> => {
    await requireServer(ctx);
    const all = await identitiesOf(ctx, userId);
    const matching = all.filter((row) => row.provider === provider);
    if (matching.length === 0) return { ok: false, reason: "not_linked" };
    if (matching.length === all.length) return { ok: false, reason: "last_method" };
    for (const row of matching) await ctx.db.delete(row._id);
    return { ok: true };
  },
});

/** Points an account at a picture the app server stored (see app/.server/media.ts). */
export const setAvatar = mutation({
  args: { userId: v.id("users"), avatarUrl: v.string() },
  handler: async (ctx, { userId, avatarUrl }) => {
    await requireServer(ctx);
    await ctx.db.patch(userId, { avatarUrl });
  },
});

export const get = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Doc<"users"> | null> => {
    await requireServer(ctx);
    return await ctx.db.get(userId);
  },
});

export const createSession = mutation({
  args: { userId: v.id("users"), tokenHash: v.string(), expiresAt: v.number() },
  handler: async (ctx, args) => {
    await requireServer(ctx);
    await ctx.db.insert("sessions", args);
  },
});

/** The signed-in user for a session cookie (hashed by the app server). */
export const resolveSession = query({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }): Promise<Doc<"users"> | null> => {
    await requireServer(ctx);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (!session || session.expiresAt < Date.now()) return null;
    return await ctx.db.get(session.userId);
  },
});

export const deleteSession = mutation({
  args: { tokenHash: v.string() },
  handler: async (ctx, { tokenHash }) => {
    await requireServer(ctx);
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_hash", (q) => q.eq("tokenHash", tokenHash))
      .unique();
    if (session) await ctx.db.delete(session._id);
  },
});

export const updateProfile = mutation({
  args: {
    userId: v.id("users"),
    username: v.string(),
    displayName: v.string(),
    bio: v.string(),
    website: v.union(v.string(), v.null()),
    timeZone: v.string(),
    showNsfw: v.boolean(),
  },
  handler: async (ctx, { userId, ...changes }): Promise<{ ok: true } | { ok: false; error: string }> => {
    await requireServer(ctx);
    const user = await ctx.db.get(userId);
    if (!user) return { ok: false, error: "Account not found." };
    const problem = usernameProblem(changes.username);
    if (problem) return { ok: false, error: problem };
    if (!isValidTimeZone(changes.timeZone)) return { ok: false, error: "Unknown time zone." };
    if (changes.username !== user.username && (await usernameTaken(ctx, changes.username))) {
      return { ok: false, error: "That username is taken." };
    }
    await ctx.db.patch(userId, {
      ...changes,
      displayName: changes.displayName.slice(0, 60) || changes.username,
      bio: changes.bio.slice(0, LIMITS.bioLength),
      // A new time zone moves 9am.
      nextDigestAt: nextDigestAt({ ...user, timeZone: changes.timeZone }, Date.now()),
    });
    return { ok: true };
  },
});

/** Turns the daily digest on or off from Settings. */
export const setEmailDigest = mutation({
  args: { userId: v.id("users"), enabled: v.boolean() },
  handler: async (ctx, { userId, enabled }) => {
    await requireServer(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("Account not found.");
    const now = Date.now();
    await ctx.db.patch(userId, {
      emailDigest: enabled,
      nextDigestAt: nextDigestAt({ ...user, emailDigest: enabled }, now),
      // Turning it back on starts from now, not from whatever piled up meanwhile.
      ...(enabled && user.emailDigest === false ? { digestSentAt: now } : {}),
    });
  },
});

/** The one-click unsubscribe link in a digest. Null when the token is unknown. */
export const unsubscribe = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<{ username: string } | null> => {
    await requireServer(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_email_token", (q) => q.eq("emailToken", token))
      .unique();
    if (!user) return null;
    await ctx.db.patch(user._id, { emailDigest: false, nextDigestAt: undefined });
    return { username: user.username };
  },
});

function toLaunches(slops: readonly Doc<"slops">[]): Launch[] {
  return slops
    .filter((slop) => !isHidden(slop))
    .map((slop) => ({ id: slop._id, name: slop.name, slug: slop.slug, launchDate: slop.launchDate }));
}

/** Everything a profile page shows; live, so votes and goal days update in place. */
export const profile = query({
  args: { username: v.string(), asUser: v.optional(v.id("users")) },
  handler: async (ctx, { username, asUser }) => {
    const owner = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", username.toLowerCase()))
      .unique();
    if (!owner) return null;
    const reader = await readerFor(ctx, asUser);
    const isSelf = reader?._id === owner._id;
    const slops = (
      await ctx.db
        .query("slops")
        .withIndex("by_user", (q) => q.eq("userId", owner._id))
        .order("desc")
        .collect()
    ).filter((slop) => !isHidden(slop) || isSelf);
    const goals = await ctx.db
      .query("goals")
      .withIndex("by_user", (q) => q.eq("userId", owner._id))
      .order("desc")
      .collect();

    const today = utcDate(Date.now());
    const launches = toLaunches(slops);
    const current = goals.find((goal) => goal.abandonedAt === null) ?? null;
    const chronological = [...slops].reverse();
    const firstHit = chronological.findIndex((slop) => slop.slopcessfulAt !== null);

    return {
      owner: publicUser(owner),
      isSelf,
      /** Today's UTC date, which goal days and streaks follow. */
      today,
      streak: currentStreak(
        launches.map((launch) => launch.launchDate),
        today,
      ),
      totalShipped: launches.length,
      upvotes: slops.reduce((sum, slop) => sum + slop.upvotes, 0),
      daysWon: slops.filter((slop) => slop.slopOfTheDay !== null).length,
      slopcessfulOnTry: firstHit === -1 ? null : firstHit + 1,
      progress: current ? goalProgress(current, launches, today, await queuedDays(ctx, owner)) : null,
      pastGoals: goals
        .filter((goal) => goal._id !== current?._id)
        .map((goal) => {
          const progress = goalProgress(goal, launches, today);
          return {
            id: goal._id,
            title: goal.title,
            shipped: progress.shipped,
            target: goal.target,
            status: progress.status,
          };
        }),
      items: await toCards(ctx, slops, reader),
    };
  },
});
