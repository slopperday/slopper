import { ConvexError, v } from "convex/values";
import { flagConditionValidator, flagDefinitionValidator, flagProblems, flagVariantValidator } from "../shared/flags";
import { mutation, query } from "./_generated/server";
import { flagDoc } from "./shapes";

/**
 * Feature flags: their definitions live here; evaluating them for a person
 * is pure (shared/flags.ts), so an app evaluates them where it renders,
 * from `definitions`, without a call per person.
 */

const flagFields = {
  key: v.string(),
  name: v.string(),
  description: v.string(),
  active: v.boolean(),
  variants: v.union(v.array(flagVariantValidator), v.null()),
  conditions: v.array(flagConditionValidator),
  payloads: v.record(v.string(), v.string()),
};

/** Every flag, newest first, for managing them. */
export const list = query({
  args: {},
  returns: v.array(flagDoc),
  handler: async (ctx) => await ctx.db.query("flags").order("desc").collect(),
});

export const get = query({
  args: { key: v.string() },
  returns: v.union(flagDoc, v.null()),
  handler: async (ctx, { key }) =>
    await ctx.db
      .query("flags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique(),
});

/** What evaluating needs, for every active flag: cache it where flags are evaluated. */
export const definitions = query({
  args: {},
  returns: v.array(flagDefinitionValidator),
  handler: async (ctx) => {
    const flags = await ctx.db
      .query("flags")
      .withIndex("by_active", (q) => q.eq("active", true))
      .collect();
    return flags.map(({ key, active, variants, conditions, payloads }) => ({
      key,
      active,
      variants,
      conditions,
      payloads,
    }));
  },
});

/** Creates a flag, or replaces one with the same key. Says whether it was new. */
export const save = mutation({
  args: flagFields,
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, flag) => {
    const problems = flagProblems(flag);
    if (problems.length > 0) throw new ConvexError(problems.join(" "));
    const now = Date.now();
    const existing = await ctx.db
      .query("flags")
      .withIndex("by_key", (q) => q.eq("key", flag.key))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { ...flag, updatedAt: now });
      return { created: false };
    }
    await ctx.db.insert("flags", { ...flag, createdAt: now, updatedAt: now });
    return { created: true };
  },
});

export const setActive = mutation({
  args: { key: v.string(), active: v.boolean() },
  returns: v.boolean(),
  handler: async (ctx, { key, active }) => {
    const flag = await ctx.db
      .query("flags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!flag) return false;
    await ctx.db.patch(flag._id, { active, updatedAt: Date.now() });
    return true;
  },
});

export const remove = mutation({
  args: { key: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { key }) => {
    const flag = await ctx.db
      .query("flags")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!flag) return false;
    const experiment = await ctx.db
      .query("experiments")
      .withIndex("by_flag", (q) => q.eq("flagKey", key))
      .first();
    if (experiment) throw new ConvexError(`The experiment “${experiment.name}” uses this flag: delete it first.`);
    await ctx.db.delete(flag._id);
    return true;
  },
});
