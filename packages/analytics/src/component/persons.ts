import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, mutation, query } from "./_generated/server";
import { pageArgs, pageByKey } from "./lib/paging";
import { markChanged } from "./lib/rollupDays";
import { personDoc } from "./shapes";

/** Rows moved or deleted per transaction, well inside Convex's write limits. */
const PAGE = 200;

/**
 * Moves the rest of a merged person's history to the person they were merged
 * into, a page at a time, then deletes them (see `merge` in lib/ingest.ts).
 */
export const finishMerge = internalMutation({
  args: { from: v.id("persons"), into: v.id("persons") },
  returns: v.null(),
  handler: async (ctx, { from, into }) => {
    const events = await ctx.db
      .query("events")
      .withIndex("by_person_timestamp", (q) => q.eq("personId", from))
      .take(PAGE);
    for (const event of events) await ctx.db.patch(event._id, { personId: into });
    const sessions = await ctx.db
      .query("sessions")
      .withIndex("by_person_started", (q) => q.eq("personId", from))
      .take(PAGE);
    for (const session of sessions) await ctx.db.patch(session._id, { personId: into });
    // The days they're on counted `from` as someone else.
    await markChanged(ctx, [
      ...events.map((event) => event.timestamp),
      ...sessions.map((session) => session.startedAt),
    ]);
    if (events.length === PAGE || sessions.length === PAGE) {
      await ctx.scheduler.runAfter(0, internal.persons.finishMerge, { from, into });
      return null;
    }
    // Ids linked while the merge ran still point here; they belong to `into` too.
    const ids = await ctx.db
      .query("distinctIds")
      .withIndex("by_person", (q) => q.eq("personId", from))
      .collect();
    for (const row of ids) await ctx.db.patch(row._id, { personId: into });
    await ctx.db.delete(from);
    return null;
  },
});

/** The person behind a distinct id, with every id they've used. */
export const get = query({
  args: { distinctId: v.string() },
  returns: v.union(v.object({ ...personDoc.fields, distinctIds: v.array(v.string()) }), v.null()),
  handler: async (ctx, { distinctId }) => {
    const row = await ctx.db
      .query("distinctIds")
      .withIndex("by_distinct_id", (q) => q.eq("distinctId", distinctId))
      .unique();
    if (!row) return null;
    const person = await ctx.db.get(row.personId);
    if (!person) return null;
    const ids = await ctx.db
      .query("distinctIds")
      .withIndex("by_person", (q) => q.eq("personId", person._id))
      .collect();
    return { ...person, distinctIds: ids.map((id) => id.distinctId) };
  },
});

const listedPerson = v.object({ ...personDoc.fields, distinctIds: v.array(v.string()) });

/** People, most recently seen first, with the ids they've used (a few of them). */
export const list = query({
  args: pageArgs,
  returns: v.object({ page: v.array(listedPerson), isDone: v.boolean(), continueCursor: v.string() }),
  handler: async (ctx, { cursor, numItems }) => {
    const persons = () => ctx.db.query("persons");
    const result = await pageByKey<Doc<"persons">>({
      cursor,
      numItems,
      key: (person) => person.lastSeenAt,
      sameKey: (at) =>
        persons()
          .withIndex("by_last_seen", (q) => q.eq("lastSeenAt", at.key).lt("_creationTime", at.created))
          .order("desc"),
      rest: (at) =>
        persons()
          .withIndex("by_last_seen", (q) => (at ? q.lt("lastSeenAt", at.key) : q))
          .order("desc"),
    });
    const page = [];
    for (const person of result.page) {
      const ids = await ctx.db
        .query("distinctIds")
        .withIndex("by_person", (q) => q.eq("personId", person._id))
        .take(5);
      page.push({ ...person, distinctIds: ids.map((id) => id.distinctId) });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** Deletes one page of a person's events and sessions; true when nothing is left. */
async function deletePage(ctx: MutationCtx, personId: Id<"persons">): Promise<boolean> {
  const events = await ctx.db
    .query("events")
    .withIndex("by_person_timestamp", (q) => q.eq("personId", personId))
    .take(PAGE);
  for (const event of events) await ctx.db.delete(event._id);
  const sessions = await ctx.db
    .query("sessions")
    .withIndex("by_person_started", (q) => q.eq("personId", personId))
    .take(PAGE);
  for (const session of sessions) await ctx.db.delete(session._id);
  await markChanged(ctx, [...events.map((event) => event.timestamp), ...sessions.map((session) => session.startedAt)]);
  return events.length < PAGE && sessions.length < PAGE;
}

export const forgetPage = internalMutation({
  args: { personId: v.id("persons") },
  returns: v.null(),
  handler: async (ctx, { personId }) => {
    if (await deletePage(ctx, personId)) await ctx.db.delete(personId);
    else await ctx.scheduler.runAfter(0, internal.persons.forgetPage, { personId });
    return null;
  },
});

/**
 * Forgets a person: their ids at once, so nothing new lands on them, then
 * their events, sessions and recordings in the background. For account deletion and
 * requests to erase someone's data. Returns whether there was anyone to forget.
 */
export const forget = mutation({
  args: { distinctId: v.string() },
  returns: v.boolean(),
  handler: async (ctx, { distinctId }) => {
    const row = await ctx.db
      .query("distinctIds")
      .withIndex("by_distinct_id", (q) => q.eq("distinctId", distinctId))
      .unique();
    if (!row) return false;
    const ids = await ctx.db
      .query("distinctIds")
      .withIndex("by_person", (q) => q.eq("personId", row.personId))
      .collect();
    for (const id of ids) await ctx.db.delete(id._id);
    await ctx.scheduler.runAfter(0, internal.persons.forgetPage, { personId: row.personId });
    await ctx.scheduler.runAfter(0, internal.recordings.forget, { distinctIds: ids.map((id) => id.distinctId) });
    return true;
  },
});
