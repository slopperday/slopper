import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, type MutationCtx, query } from "./_generated/server";
import { readerFor, requireServer } from "./lib/auth";
import { publicUser, toCards } from "./lib/shape";
import { currentStreak, isValidTimeZone, localDate } from "../app/lib/dates";
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
  },
  handler: async (ctx, args): Promise<{ userId: Id<"users">; created: boolean }> => {
    await requireServer(ctx);
    const identity = await ctx.db
      .query("identities")
      .withIndex("by_provider_id", (q) => q.eq("provider", args.provider).eq("providerId", args.providerId))
      .unique();
    if (identity && (await ctx.db.get(identity.userId))) return { userId: identity.userId, created: false };

    const username = await freeUsername(ctx, args.preferredUsername);
    const userId = await ctx.db.insert("users", {
      username,
      displayName: args.displayName.slice(0, 60) || username,
      avatarUrl: args.avatarUrl,
      bio: (args.bio ?? "").slice(0, LIMITS.bioLength),
      website: args.website ?? null,
      timeZone: isValidTimeZone(args.timeZone) ? args.timeZone : "UTC",
      showNsfw: false,
    });
    if (identity) await ctx.db.patch(identity._id, { userId });
    else await ctx.db.insert("identities", { provider: args.provider, providerId: args.providerId, userId });
    return { userId, created: true };
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
    });
    return { ok: true };
  },
});

function toLaunches(slops: readonly Doc<"slops">[]): Launch[] {
  return slops
    .filter((slop) => !slop.hidden)
    .map((slop) => ({ id: slop._id, name: slop.name, slug: slop.slug, launchDate: slop.launchDate }));
}

/** Everything a profile page shows; live, so votes and splats update in place. */
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
    ).filter((slop) => !slop.hidden || isSelf);
    const goals = await ctx.db
      .query("goals")
      .withIndex("by_user", (q) => q.eq("userId", owner._id))
      .order("desc")
      .collect();

    const today = localDate(new Date(), owner.timeZone);
    const launches = toLaunches(slops);
    const current = goals.find((goal) => goal.abandonedAt === null) ?? null;
    const chronological = [...slops].reverse();
    const firstHit = chronological.findIndex((slop) => slop.slopcessfulAt !== null);

    return {
      owner: publicUser(owner),
      isSelf,
      streak: currentStreak(
        launches.map((launch) => launch.launchDate),
        today,
      ),
      totalShipped: launches.length,
      upvotes: slops.reduce((sum, slop) => sum + slop.upvotes, 0),
      daysWon: slops.filter((slop) => slop.slopOfTheDay !== null).length,
      slopcessfulOnTry: firstHit === -1 ? null : firstHit + 1,
      progress: current ? goalProgress(current, launches, today) : null,
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
