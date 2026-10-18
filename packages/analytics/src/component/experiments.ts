import { ConvexError, v } from "convex/values";
import { FLAG_KEY } from "../shared/flags";
import { propertyFilterValidator } from "../shared/insights/queries";
import { mutation, query } from "./_generated/server";
import { experimentDoc } from "./shapes";

/**
 * Experiments: a flag with variants, a goal event, and when it ran. Results
 * are worked out from events (src/convex/experiments.ts), not stored.
 */

const goalValidator = v.object({ event: v.string(), filters: v.array(propertyFilterValidator) });

export const list = query({
  args: {},
  returns: v.array(experimentDoc),
  handler: async (ctx) => await ctx.db.query("experiments").order("desc").collect(),
});

export const get = query({
  args: { key: v.string() },
  returns: v.union(experimentDoc, v.null()),
  handler: async (ctx, { key }) =>
    await ctx.db
      .query("experiments")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
});

/** Makes a draft, or changes one that hasn't started. */
export const save = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    hypothesis: v.string(),
    flagKey: v.string(),
    goal: goalValidator,
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, fields) => {
    if (!FLAG_KEY.test(fields.key)) throw new ConvexError("A key is lowercase letters, digits and dashes.");
    if (!fields.goal.event.trim()) throw new ConvexError("Say which event counts as the goal.");
    const flag = await ctx.db
      .query("flags")
      .withIndex("by_key", (q) => q.eq("key", fields.flagKey))
      .unique();
    if (!flag?.variants || flag.variants.length < 2) {
      throw new ConvexError("An experiment needs a flag with two variants at least.");
    }
    const existing = await ctx.db
      .query("experiments")
      .withIndex("by_key", (q) => q.eq("key", fields.key))
      .unique();
    if (existing) {
      if (existing.status !== "draft") throw new ConvexError("It has started: what it tests can't change now.");
      await ctx.db.patch(existing._id, fields);
      return { created: false };
    }
    await ctx.db.insert("experiments", { ...fields, status: "draft", startedAt: null, endedAt: null });
    return { created: true };
  },
});

/** Starts it, turning its flag on: people get variants from now. */
export const start = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const experiment = await ctx.db
      .query("experiments")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!experiment) throw new ConvexError("There's no such experiment.");
    if (experiment.status !== "draft") throw new ConvexError("It has already started.");
    const flag = await ctx.db
      .query("flags")
      .withIndex("by_key", (q) => q.eq("key", experiment.flagKey))
      .unique();
    if (!flag) throw new ConvexError("Its flag is gone.");
    const now = Date.now();
    await ctx.db.patch(flag._id, { active: true, updatedAt: now });
    await ctx.db.patch(experiment._id, { status: "running", startedAt: now });
    return null;
  },
});

/** Stops it: results stay as they were then. Its flag stays as it is, for whoever ships the winner. */
export const stop = mutation({
  args: { key: v.string() },
  returns: v.null(),
  handler: async (ctx, { key }) => {
    const experiment = await ctx.db
      .query("experiments")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!experiment || experiment.status !== "running") throw new ConvexError("It isn't running.");
    await ctx.db.patch(experiment._id, { status: "stopped", endedAt: Date.now() });
    return null;
  },
});

export const remove = mutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { key }) => {
    const experiment = await ctx.db
      .query("experiments")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!experiment) return false;
    await ctx.db.delete(experiment._id);
    return true;
  },
});
