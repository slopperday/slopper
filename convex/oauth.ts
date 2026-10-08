import { v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { oauthIntentValidator } from "./schema";

/** In-flight OAuth authorizations. Each `state` can be taken exactly once. */

const TTL_MS = 10 * 60_000;

export const save = mutation({
  args: {
    state: v.string(),
    provider: v.string(),
    intent: oauthIntentValidator,
    codeVerifier: v.string(),
    userId: v.union(v.id("users"), v.null()),
    returnTo: v.string(),
  },
  handler: async (ctx, args) => {
    await requireServer(ctx);
    await ctx.db.insert("oauthStates", { ...args, expiresAt: Date.now() + TTL_MS });
  },
});

export const take = mutation({
  args: { state: v.string() },
  handler: async (ctx, { state }) => {
    await requireServer(ctx);
    const pending = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .unique();
    if (!pending) return null;
    await ctx.db.delete(pending._id);
    if (pending.expiresAt < Date.now()) return null;
    const { provider, intent, codeVerifier, userId, returnTo } = pending;
    return { provider, intent, codeVerifier, userId, returnTo };
  },
});
