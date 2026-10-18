import { v } from "convex/values";
import { query } from "./_generated/server";
import { eventDoc } from "./shapes";

const MAX_RECENT = 200;

/**
 * The latest events, newest first: everyone's, one event's, or one
 * person's (by any of their distinct ids). A live feed when subscribed to.
 */
export const recent = query({
  args: {
    distinctId: v.optional(v.string()),
    name: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(eventDoc),
  handler: async (ctx, { distinctId, name, limit }) => {
    const take = Math.max(1, Math.min(limit ?? 50, MAX_RECENT));
    if (distinctId !== undefined) {
      const row = await ctx.db
        .query("distinctIds")
        .withIndex("by_distinct_id", (q) => q.eq("distinctId", distinctId))
        .unique();
      if (!row) return [];
      const theirs = ctx.db
        .query("events")
        .withIndex("by_person_timestamp", (q) => q.eq("personId", row.personId))
        .order("desc");
      return await (name === undefined ? theirs : theirs.filter((q) => q.eq(q.field("name"), name))).take(take);
    }
    if (name !== undefined) {
      return await ctx.db
        .query("events")
        .withIndex("by_name_timestamp", (q) => q.eq("name", name))
        .order("desc")
        .take(take);
    }
    return await ctx.db.query("events").withIndex("by_timestamp").order("desc").take(take);
  },
});
