import { ConvexError, v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { requireServer } from "./lib/auth";

/** Personal API tokens for agents. Only hashes are stored. */

const MAX_TOKENS = 10;

export const create = mutation({
  args: { userId: v.id("users"), name: v.string(), preview: v.string(), hash: v.string() },
  handler: async (ctx, args) => {
    await requireServer(ctx);
    const existing = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    if (existing.length >= MAX_TOKENS) throw new ConvexError(`Up to ${MAX_TOKENS} tokens. Revoke one first.`);
    return await ctx.db.insert("apiTokens", {
      ...args,
      name: args.name.trim().slice(0, 60) || "Agent",
      lastUsedAt: null,
    });
  },
});

export const list = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    await requireServer(ctx);
    const tokens = await ctx.db
      .query("apiTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return tokens.map(({ _id, name, preview, lastUsedAt, _creationTime }) => ({
      id: _id,
      name,
      preview,
      lastUsedAt,
      createdAt: _creationTime,
    }));
  },
});

export const revoke = mutation({
  args: { userId: v.id("users"), tokenId: v.string() },
  handler: async (ctx, { userId, tokenId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("apiTokens", tokenId);
    const token = id ? await ctx.db.get(id) : null;
    if (token && token.userId === userId) await ctx.db.delete(token._id);
  },
});

/** The user behind a bearer token, recording when it was last used. */
export const use = mutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }): Promise<Doc<"users"> | null> => {
    await requireServer(ctx);
    const token = await ctx.db
      .query("apiTokens")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!token) return null;
    // Touch at most hourly so busy agents don't write on every call.
    if (Date.now() - (token.lastUsedAt ?? 0) > 3_600_000) await ctx.db.patch(token._id, { lastUsedAt: Date.now() });
    return await ctx.db.get(token.userId);
  },
});
