import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { productIdOf } from "./lib/shape";

/** A product's costs and revenue, shared by all of its launches. */

export const add = mutation({
  args: {
    userId: v.id("users"),
    slopId: v.id("slops"),
    kind: v.union(v.literal("cost"), v.literal("revenue")),
    amount: v.number(),
    currency: v.string(),
    category: v.string(),
    note: v.string(),
    date: v.string(),
  },
  handler: async (ctx, { userId, slopId, ...entry }) => {
    await requireServer(ctx);
    // Whole dollars only, the way every caller already sends them: Convex's
    // v.number() alone would take NaN, negatives and fractions from a future
    // caller, and NaN quietly poisons every total it touches.
    if (!Number.isInteger(entry.amount) || entry.amount <= 0 || entry.amount > 1e12) {
      throw new ConvexError("Amounts are whole dollars above zero.");
    }
    const slop = await ctx.db.get(slopId);
    if (!slop || slop.userId !== userId) throw new ConvexError("That slop isn't yours.");
    return await ctx.db.insert("ledger", {
      ...entry,
      currency: entry.currency.trim().slice(0, 8).toUpperCase(),
      category: entry.category.trim().slice(0, 40),
      note: entry.note.trim().slice(0, 200),
      userId,
      productId: productIdOf(slop),
    });
  },
});

export const remove = mutation({
  args: { userId: v.id("users"), entryId: v.string() },
  handler: async (ctx, { userId, entryId }) => {
    await requireServer(ctx);
    const id = ctx.db.normalizeId("ledger", entryId);
    const entry = id ? await ctx.db.get(id) : null;
    if (entry && entry.userId === userId) await ctx.db.delete(entry._id);
  },
});

export const setPublic = mutation({
  args: { userId: v.id("users"), slopId: v.id("slops"), visible: v.boolean() },
  handler: async (ctx, { userId, slopId, visible }) => {
    await requireServer(ctx);
    const slop = await ctx.db.get(slopId);
    if (!slop || slop.userId !== userId) throw new ConvexError("That slop isn't yours.");
    await ctx.db.patch(productIdOf(slop), { moneyPublic: visible });
  },
});
