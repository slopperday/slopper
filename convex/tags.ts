import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { retag } from "./lib/tags";

/** Tags people have used, most used first, for the "Made with" picker. */
export const popular = query({
  args: { limit: v.optional(v.number()) },
  returns: v.array(v.object({ name: v.string(), uses: v.number() })),
  handler: async (ctx, { limit }) => {
    const rows = await ctx.db
      .query("madeWithTags")
      .withIndex("by_uses", (q) => q.gt("uses", 0))
      .order("desc")
      .take(Math.min(Math.max(1, limit ?? 200), 500));
    return rows.map(({ name, uses }) => ({ name, uses }));
  },
});

/**
 * Counts every slop's tags from scratch and respells them (known tags the
 * way app/lib/tags.ts does, the rest as first used). Runs after each Convex
 * deploy (scripts/release.ts) and does nothing once tags are counted.
 */
export const backfill = internalMutation({
  args: { force: v.optional(v.boolean()) },
  returns: v.object({ slops: v.number(), tags: v.number() }),
  handler: async (ctx, { force }) => {
    const counted = await ctx.db.query("madeWithTags").first();
    if (counted && !force) return { slops: 0, tags: 0 };
    for (const row of await ctx.db.query("madeWithTags").collect()) await ctx.db.delete(row._id);
    let slops = 0;
    for await (const slop of ctx.db.query("slops")) {
      const madeWith = await retag(ctx, [], slop.madeWith);
      if (madeWith.join("\n") !== slop.madeWith.join("\n")) await ctx.db.patch(slop._id, { madeWith });
      slops++;
    }
    const tags = (await ctx.db.query("madeWithTags").collect()).length;
    return { slops, tags };
  },
});
