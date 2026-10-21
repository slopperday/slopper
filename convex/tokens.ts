import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import { requireServer } from "./lib/auth";

/** Personal API tokens for agents. Only hashes are stored. */

const MAX_TOKENS = 10;

/** A token lives a year from its creation: a leaked one stops working on its own. */
export const TOKEN_DAYS = 365;
const TOKEN_MS = TOKEN_DAYS * 86_400_000;

export interface NewToken {
  userId: Id<"users">;
  name: string;
  preview: string;
  hash: string;
}

/** A token's name as it's stored: trimmed, at most 60 characters, "Agent" when empty. */
export function tokenName(name: string): string {
  return name.trim().slice(0, 60) || "Agent";
}

/** Stores a token's hash, up to MAX_TOKENS a person. Shared with `cliLogins.collect`. */
export async function insertToken(ctx: MutationCtx, token: NewToken): Promise<Id<"apiTokens">> {
  const existing = await ctx.db
    .query("apiTokens")
    .withIndex("by_user", (q) => q.eq("userId", token.userId))
    .collect();
  if (existing.length >= MAX_TOKENS) throw new ConvexError(`Up to ${MAX_TOKENS} tokens. Revoke one first.`);
  return await ctx.db.insert("apiTokens", {
    ...token,
    name: tokenName(token.name),
    lastUsedAt: null,
  });
}

export const create = mutation({
  args: { userId: v.id("users"), name: v.string(), preview: v.string(), hash: v.string() },
  handler: async (ctx, args) => {
    await requireServer(ctx);
    return await insertToken(ctx, args);
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

/** The user behind a bearer token, recording when it was last used. A token older than a year is done. */
export const use = mutation({
  args: { hash: v.string() },
  handler: async (ctx, { hash }): Promise<Doc<"users"> | null> => {
    await requireServer(ctx);
    const token = await ctx.db
      .query("apiTokens")
      .withIndex("by_hash", (q) => q.eq("hash", hash))
      .unique();
    if (!token) return null;
    if (Date.now() - token._creationTime > TOKEN_MS) {
      await ctx.db.delete(token._id);
      return null;
    }
    // Touch at most hourly so busy agents don't write on every call.
    if (Date.now() - (token.lastUsedAt ?? 0) > 3_600_000) await ctx.db.patch(token._id, { lastUsedAt: Date.now() });
    return await ctx.db.get(token.userId);
  },
});
