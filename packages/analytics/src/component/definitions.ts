import { v } from "convex/values";
import { query } from "./_generated/server";

/** Every event name seen, most recently seen first: for pickers. */
export const list = query({
  args: {},
  returns: v.array(v.object({ name: v.string(), firstSeenAt: v.number(), lastSeenAt: v.number() })),
  handler: async (ctx) => {
    const definitions = await ctx.db.query("eventDefinitions").withIndex("by_last_seen").order("desc").take(500);
    return definitions.map(({ name, firstSeenAt, lastSeenAt }) => ({ name, firstSeenAt, lastSeenAt }));
  },
});
