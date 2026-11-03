import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { socialProviderValidator } from "./schema";
import { NETWORKS } from "../app/lib/networks";

/** Connected social accounts. Credentials arrive sealed by the app server. */

const mode = v.union(v.literal("post"), v.literal("amplify"), v.literal("off"));
const provider = socialProviderValidator;

export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<Doc<"accounts">[]> => {
    await requireServer(ctx);
    return await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/**
 * Connects an account, or refreshes the credentials when the same remote
 * account is connected again (LinkedIn's 60 day reconnect).
 */
export const connect = mutation({
  args: {
    userId: v.id("users"),
    provider,
    remoteId: v.string(),
    handle: v.string(),
    displayName: v.string(),
    avatarUrl: v.union(v.string(), v.null()),
    sealedCredentials: v.string(),
    expiresAt: v.union(v.string(), v.null()),
    initialMode: v.optional(mode),
    brand: v.optional(v.string()),
  },
  handler: async (ctx, { initialMode, ...args }): Promise<Doc<"accounts">> => {
    await requireServer(ctx);
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_user_remote", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider).eq("remoteId", args.remoteId),
      )
      .unique();
    if (existing) {
      // Reconnecting refreshes the credentials; the brand and choices stay as they were.
      const { brand: _brand, ...fresh } = args;
      await ctx.db.patch(existing._id, { ...fresh, broken: undefined });
      return { ...existing, ...fresh, broken: undefined };
    }
    const siblings = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    // A person's first account on a network posts; extra ones repost where
    // the network can, and stay off where it can't, so a new brand's Page
    // never gets another product's posts.
    const second = siblings.some((account) => account.provider === args.provider);
    const defaultMode = initialMode ?? (!second ? "post" : NETWORKS[args.provider].canRepost ? "amplify" : "off");
    const id = await ctx.db.insert("accounts", { ...args, defaultMode });
    const account = await ctx.db.get(id);
    if (!account) throw new Error("Account vanished after insert");
    return account;
  },
});

export const storeCredentials = mutation({
  args: { accountId: v.id("accounts"), sealedCredentials: v.string() },
  handler: async (ctx, { accountId, sealedCredentials }) => {
    await requireServer(ctx);
    await ctx.db.patch(accountId, { sealedCredentials });
  },
});

export const setDefaultMode = mutation({
  args: { userId: v.id("users"), accountId: v.string(), mode },
  handler: async (ctx, { userId, accountId, mode: next }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id ? await ctx.db.get(id) : null;
    if (!account || account.userId !== userId) return;
    if (next === "amplify" && !NETWORKS[account.provider].canRepost) return;
    await ctx.db.patch(account._id, { defaultMode: next });
  },
});

export const disconnect = mutation({
  args: { userId: v.id("users"), accountId: v.string() },
  handler: async (ctx, { userId, accountId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id ? await ctx.db.get(id) : null;
    if (account && account.userId === userId) await ctx.db.delete(account._id);
  },
});

/** Names the brand an account speaks for; empty clears it. */
export const setBrand = mutation({
  args: { userId: v.id("users"), accountId: v.string(), brand: v.string() },
  handler: async (ctx, { userId, accountId, brand }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id ? await ctx.db.get(id) : null;
    if (!account || account.userId !== userId) return;
    const name = brand.trim().replace(/\s+/g, " ").slice(0, 40);
    await ctx.db.patch(account._id, { brand: name || undefined });
  },
});

/** One account, credentials and all, for the app server's sends. */
export const get = query({
  args: { accountId: v.id("accounts") },
  handler: async (ctx, { accountId }): Promise<Doc<"accounts"> | null> => {
    await requireServer(ctx);
    return await ctx.db.get(accountId);
  },
});

/** Marks an X account as Premium (long posts), or not. */
export const setLongPosts = mutation({
  args: { userId: v.id("users"), accountId: v.string(), longPosts: v.boolean() },
  handler: async (ctx, { userId, accountId, longPosts }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("accounts", accountId);
    const account = id ? await ctx.db.get(id) : null;
    if (!account || account.userId !== userId || account.provider !== "x") return;
    await ctx.db.patch(account._id, { longPosts: longPosts || undefined });
  },
});

/** Says posting as an account stopped working, until it's reconnected. */
export const markBroken = mutation({
  args: { accountId: v.id("accounts"), reason: v.string() },
  handler: async (ctx, { accountId, reason }) => {
    await requireServer(ctx);
    const account = await ctx.db.get(accountId);
    if (account) await ctx.db.patch(account._id, { broken: reason.slice(0, 300) });
  },
});
