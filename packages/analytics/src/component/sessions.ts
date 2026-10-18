import { v } from "convex/values";
import { query } from "./_generated/server";
import { eventDoc, sessionDoc } from "./shapes";

const MAX_LIST = 200;

/** Sessions with activity since `since`, latest first: who's here now, live when subscribed to. */
export const active = query({
  args: { since: v.number(), limit: v.optional(v.number()) },
  returns: v.array(sessionDoc),
  handler: async (ctx, { since, limit }) => {
    return await ctx.db
      .query("sessions")
      .withIndex("by_ended", (q) => q.gte("endedAt", since))
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? 50, MAX_LIST)));
  },
});

/** One person's sessions (by any of their distinct ids), latest first. */
export const forPerson = query({
  args: { distinctId: v.string(), limit: v.optional(v.number()) },
  returns: v.array(sessionDoc),
  handler: async (ctx, { distinctId, limit }) => {
    const row = await ctx.db
      .query("distinctIds")
      .withIndex("by_distinct_id", (q) => q.eq("distinctId", distinctId))
      .unique();
    if (!row) return [];
    return await ctx.db
      .query("sessions")
      .withIndex("by_person_started", (q) => q.eq("personId", row.personId))
      .order("desc")
      .take(Math.max(1, Math.min(limit ?? 50, MAX_LIST)));
  },
});

/** Events shown for one session; a longer one is cut off here. */
const SESSION_EVENTS = 500;

/** One session and its events, oldest first. */
export const get = query({
  args: { sessionId: v.string() },
  returns: v.union(v.object({ session: sessionDoc, events: v.array(eventDoc) }), v.null()),
  handler: async (ctx, { sessionId }) => {
    const session = await ctx.db
      .query("sessions")
      .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
      .unique();
    if (!session) return null;
    const events = await ctx.db
      .query("events")
      .withIndex("by_session_timestamp", (q) => q.eq("sessionId", sessionId))
      .take(SESSION_EVENTS);
    return { session, events };
  },
});
