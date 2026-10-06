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
    const slop = await ctx.db.get(slopId);
    if (!slop || slop.userId !== userId) throw new ConvexError("That slop isn't yours.");
    return await ctx.db.insert("ledger", { ...entry, userId, productId: productIdOf(slop) });
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
