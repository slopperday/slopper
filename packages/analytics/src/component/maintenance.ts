import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation, type MutationCtx, mutation } from "./_generated/server";
import { DEFINITION_RESOLUTION_MS } from "./lib/ingest";
import { sweepRecordings } from "./recordings";

const DAY_MS = 86_400_000;
/** How long recordings are kept unless the app says otherwise: they're big, and old ones are rarely watched. */
const RECORDING_DAYS = 30;
/** Rows deleted per table per transaction. */
const PAGE = 500;

const retentionValidator = v.object({
  /** Raw events, and the sessions they make up. */
  eventDays: v.number(),
  /** People not seen for this long are deleted, with their ids. */
  personDays: v.number(),
  /** Session recordings; 30 days unless set. */
  recordingDays: v.optional(v.number()),
});

async function sweepPage(
  ctx: MutationCtx,
  retention: { eventDays: number; personDays: number; recordingDays?: number },
  now: number,
): Promise<{ deleted: number; more: boolean }> {
  const eventCutoff = now - retention.eventDays * DAY_MS;
  const personCutoff = now - retention.personDays * DAY_MS;
  // Events go name by name, as there's no index on the timestamp alone. A name nothing has used
  // in the retention period drops off the pickers once its last events are gone; until then it
  // stays, since reading every event goes name by name too (`scan.eventNames`).
  let events = 0;
  let definitions = 0;
  for (const definition of await ctx.db.query("eventDefinitions").collect()) {
    if (events === PAGE) break;
    const old = await ctx.db
      .query("events")
      .withIndex("by_name_timestamp", (q) => q.eq("name", definition.name).lt("timestamp", eventCutoff))
      .take(PAGE - events);
    for (const event of old) await ctx.db.delete(event._id);
    events += old.length;
    if (events === PAGE) break;
    // Its last-seen time is at most DEFINITION_RESOLUTION_MS behind its latest event.
    if (definition.lastSeenAt < eventCutoff - DEFINITION_RESOLUTION_MS) {
      await ctx.db.delete(definition._id);
      definitions += 1;
    }
  }
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
  // Rollups go with the events they were made from, the day the cutoff falls on included.
  let rollups = 0;
  let moreRollups = false;
  for (const table of ["rollupDays", "webDays", "eventDays", "groupDays"] as const) {
    const rows = await ctx.db
      .query(table)
      .withIndex("by_day", (q) => q.lt("day", eventCutoff))
      .take(PAGE);
    for (const row of rows) await ctx.db.delete(row._id);
    rollups += rows.length;
    if (rows.length === PAGE) moreRollups = true;
  }
  const recordings = await sweepRecordings(ctx, now - (retention.recordingDays ?? RECORDING_DAYS) * DAY_MS);
  return {
    deleted: events + sessions.length + persons.length + definitions + rollups + recordings.deleted,
    more: events === PAGE || sessions.length === PAGE || persons.length === PAGE / 5 || moreRollups || recordings.more,
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
    if (retention.recordingDays !== undefined && retention.recordingDays < 1) {
      throw new Error("Keep recordings for a day at least.");
    }
    const now = Date.now();
    const result = await sweepPage(ctx, retention, now);
    if (result.more) await ctx.scheduler.runAfter(0, internal.maintenance.continueSweep, { retention, now });
    return result;
  },
});
