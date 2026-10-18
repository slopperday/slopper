import { type Validator, v } from "convex/values";
import { ROLLUP_SETTLE_MS } from "../shared/insights/rollups";
import { DAY_MS } from "../shared/insights/time";
import type { Doc } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { CHANGE_RESOLUTION_MS } from "./lib/rollupDays";
import { pageArgs, pageByKey } from "./lib/paging";
import { eventDayValidator, groupDayValidator, webDayValidator } from "./rollupValidators";

/**
 * Daily rollups (shared/insights/rollups.ts): the insights engine reads
 * whole past days from here and only the rest from raw events. An app's
 * daily cron fills them (`Analytics.rollUp`): it asks which days are
 * `pending`, reads each day's raw rows page by page, and `write`s the day.
 */

const rangeArgs = { from: v.number(), to: v.number() };

const page = <Row extends Validator<unknown, "required", string>>(row: Row) =>
  v.object({ page: v.array(row), isDone: v.boolean(), continueCursor: v.string() });

function strip<Row extends { _id: unknown; _creationTime: number }>({
  _id,
  _creationTime,
  ...row
}: Row): Omit<Row, "_id" | "_creationTime"> {
  return row;
}

/** The days in the range that are rolled up and unchanged since, oldest first. */
export const days = query({
  args: rangeArgs,
  returns: v.array(v.number()),
  handler: async (ctx, { from, to }) => {
    const markers = await ctx.db
      .query("rollupDays")
      .withIndex("by_day", (q) => q.gte("day", from).lt("day", to))
      .collect();
    return markers.flatMap((marker) => (marker.rolledAt === null ? [] : [marker.day]));
  },
});

/** Web rollups for days in the range, oldest first. Only days `days` lists are current. */
export const web = query({
  args: { ...rangeArgs, ...pageArgs },
  returns: page(webDayValidator),
  handler: async (ctx, { from, to, cursor, numItems }) => {
    const rows = () => ctx.db.query("webDays");
    const result = await pageByKey<Doc<"webDays">>({
      cursor,
      numItems,
      key: (row) => row.day,
      sameKey: (at) => rows().withIndex("by_day", (q) => q.eq("day", at.key).gt("_creationTime", at.created)),
      rest: (at) => rows().withIndex("by_day", (q) => (at ? q.gt("day", at.key) : q.gte("day", from)).lt("day", to)),
    });
    return { ...result, page: result.page.map(strip) };
  },
});

/** One event name's rollups (`ANY_EVENT` for every event) for days in the range, oldest first. */
export const events = query({
  args: { name: v.string(), ...rangeArgs, ...pageArgs },
  returns: page(eventDayValidator),
  handler: async (ctx, { name, from, to, cursor, numItems }) => {
    const rows = () => ctx.db.query("eventDays");
    const result = await pageByKey<Doc<"eventDays">>({
      cursor,
      numItems,
      key: (row) => row.day,
      sameKey: (at) =>
        rows().withIndex("by_name_day", (q) => q.eq("name", name).eq("day", at.key).gt("_creationTime", at.created)),
      rest: (at) =>
        rows().withIndex("by_name_day", (q) =>
          (at ? q.eq("name", name).gt("day", at.key) : q.eq("name", name).gte("day", from)).lt("day", to),
        ),
    });
    return { ...result, page: result.page.map(strip) };
  },
});

/** Every group's page-view rollups for days in the range, oldest first. */
export const groups = query({
  args: { ...rangeArgs, ...pageArgs },
  returns: page(groupDayValidator),
  handler: async (ctx, { from, to, cursor, numItems }) => {
    const rows = () => ctx.db.query("groupDays");
    const result = await pageByKey<Doc<"groupDays">>({
      cursor,
      numItems,
      key: (row) => row.day,
      sameKey: (at) => rows().withIndex("by_day", (q) => q.eq("day", at.key).gt("_creationTime", at.created)),
      rest: (at) => rows().withIndex("by_day", (q) => (at ? q.gt("day", at.key) : q.gte("day", from)).lt("day", to)),
    });
    return { ...result, page: result.page.map(strip) };
  },
});

/**
 * Days to roll up, oldest first: every day in the range without a current
 * rollup, and any earlier day that changed since it was rolled up. Days too
 * busy to roll up wait until they change.
 */
export const pending = query({
  args: { ...rangeArgs, limit: v.number() },
  returns: v.array(v.number()),
  handler: async (ctx, { from, to, limit }) => {
    const markers = await ctx.db
      .query("rollupDays")
      .withIndex("by_day", (q) => q.gte("day", from).lt("day", to))
      .collect();
    const settled = new Set(
      markers.flatMap((marker) => (marker.rolledAt !== null || marker.oversized ? [marker.day] : [])),
    );
    const due = new Set<number>();
    for (let day = from; day + DAY_MS <= to; day += DAY_MS) if (!settled.has(day)) due.add(day);
    const changed = await ctx.db
      .query("rollupDays")
      .withIndex("by_rolled_day", (q) => q.eq("rolledAt", null).lt("day", from))
      .take(limit);
    for (const marker of changed) if (!marker.oversized) due.add(marker.day);
    return [...due].sort((a, b) => a - b).slice(0, limit);
  },
});

const rowsValidator = v.object({
  web: webDayValidator,
  events: v.array(eventDayValidator),
  groups: v.array(groupDayValidator),
});

/**
 * Replaces a day's rollup with rows made from reads that began at
 * `startedAt`, or marks the day too busy to roll up (`rows: null`). Nothing
 * is written if the day changed since shortly before then: the rows may
 * have missed it, and the next roll-up tries again.
 */
export const write = mutation({
  args: { day: v.number(), startedAt: v.number(), rows: v.union(rowsValidator, v.null()) },
  returns: v.union(v.literal("rolled"), v.literal("oversized"), v.literal("changed")),
  handler: async (ctx, { day, startedAt, rows }) => {
    if (day + DAY_MS > startedAt - ROLLUP_SETTLE_MS) throw new Error("A day is rolled up once it's over and settled.");
    if (rows && [rows.web, ...rows.events, ...rows.groups].some((row) => row.day !== day)) {
      throw new Error("Every row of a day's rollup is for that day.");
    }
    const marker = await ctx.db
      .query("rollupDays")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    // A change is marked at most CHANGE_RESOLUTION_MS after it happened.
    if (marker && marker.changedAt >= startedAt - ROLLUP_SETTLE_MS - CHANGE_RESOLUTION_MS) return "changed";
    for (const table of ["webDays", "eventDays", "groupDays"] as const) {
      const old = await ctx.db
        .query(table)
        .withIndex("by_day", (q) => q.eq("day", day))
        .collect();
      for (const row of old) await ctx.db.delete(row._id);
    }
    if (rows) {
      await ctx.db.insert("webDays", rows.web);
      for (const row of rows.events) await ctx.db.insert("eventDays", row);
      for (const row of rows.groups) await ctx.db.insert("groupDays", row);
    }
    const fields = { rolledAt: rows ? startedAt : null, oversized: rows === null };
    if (marker) await ctx.db.patch(marker._id, fields);
    else await ctx.db.insert("rollupDays", { day, changedAt: 0, ...fields });
    return rows ? "rolled" : "oversized";
  },
});
