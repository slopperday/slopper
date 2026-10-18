import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx, mutation } from "./_generated/server";

const DAY_MS = 86_400_000;
/** Rows deleted per table per transaction. */
const PAGE = 500;

const retentionValidator = v.object({
  /** Raw events, and the sessions they make up. */
  eventDays: v.number(),
  /** People not seen for this long are deleted, with their ids. */
  personDays: v.number(),
});

async function sweepPage(
  ctx: MutationCtx,
  retention: { eventDays: number; personDays: number },
  now: number,
): Promise<{ deleted: number; more: boolean }> {
  const eventCutoff = now - retention.eventDays * DAY_MS;
  const personCutoff = now - retention.personDays * DAY_MS;
  const events = await ctx.db
    .query("events")
    .withIndex("by_timestamp", (q) => q.lt("timestamp", eventCutoff))
    .take(PAGE);
  for (const event of events) await ctx.db.delete(event._id);
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_started", (q) => q.lt("startedAt", eventCutoff))
    .take(PAGE);
  for (const session of sessions) await ctx.db.delete(session._id);
  const persons = await ctx.db
    .query("persons")
    .withIndex("by_last_seen", (q) => q.lt("lastSeenAt", personCutoff))
    .take(PAGE / 5);
  for (const person of persons) {
    const ids = await ctx.db
      .query("distinctIds")
      .withIndex("by_person", (q) => q.eq("personId", person._id))
      .collect();
    for (const id of ids) await ctx.db.delete(id._id);
    await ctx.db.delete(person._id);
  }
  // Names nothing has used in the retention period drop off the pickers.
  const definitions = await ctx.db
    .query("eventDefinitions")
    .withIndex("by_last_seen", (q) => q.lt("lastSeenAt", eventCutoff))
    .take(PAGE);
  for (const definition of definitions) await ctx.db.delete(definition._id);
  return {
    deleted: events.length + sessions.length + persons.length + definitions.length,
    more: events.length === PAGE || sessions.length === PAGE || persons.length === PAGE / 5,
  };
}

export const continueSweep = internalMutation({
  args: { retention: retentionValidator, now: v.number() },
  returns: v.null(),
  handler: async (ctx, { retention, now }) => {
    const { more } = await sweepPage(ctx, retention, now);
    if (more) await ctx.scheduler.runAfter(0, internal.maintenance.continueSweep, { retention, now });
    return null;
  },
});

/**
 * Deletes what's past its retention. Call it from a daily cron in the app;
 * it keeps going in the background until everything that's due is gone.
 */
export const sweep = mutation({
  args: { retention: retentionValidator },
  returns: v.object({ deleted: v.number(), more: v.boolean() }),
  handler: async (ctx, { retention }) => {
    if (retention.eventDays < 1 || retention.personDays < retention.eventDays) {
      throw new Error("Keep events for a day at least, and people at least as long as their events.");
    }
    const now = Date.now();
    const result = await sweepPage(ctx, retention, now);
    if (result.more) await ctx.scheduler.runAfter(0, internal.maintenance.continueSweep, { retention, now });
    return result;
  },
});
