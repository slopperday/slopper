import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireServer } from "./lib/auth";

/** Connected social accounts. Credentials arrive sealed by the app server. */

const mode = v.union(v.literal("post"), v.literal("amplify"), v.literal("off"));
const provider = v.union(v.literal("x"), v.literal("linkedin"), v.literal("bluesky"));

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
  },
  handler: async (ctx, args): Promise<Doc<"accounts">> => {
    await requireServer(ctx);
    const existing = await ctx.db
      .query("accounts")
      .withIndex("by_user_remote", (q) =>
        q.eq("userId", args.userId).eq("provider", args.provider).eq("remoteId", args.remoteId),
      )
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, args);
      return { ...existing, ...args };
    }
    const siblings = await ctx.db
      .query("accounts")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    // A person's first account on a network posts; extra ones repost.
    const defaultMode = siblings.some((account) => account.provider === args.provider) ? "amplify" : "post";
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
    if (account.provider === "linkedin" && next === "amplify") return;
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
