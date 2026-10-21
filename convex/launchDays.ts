import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx } from "./_generated/server";
import { isIsoDate } from "../app/lib/dates";
import { goalDayFor } from "../app/lib/goal";

/**
 * Launch days are UTC days (app/lib/dates.ts). Before that, `launchDate`
 * held the maker's own date, so a launch just after a local midnight ahead
 * of UTC counted for the next day. These put a launch on another day by
 * hand; its goal day follows. Run with `convex run`.
 */

/** The goal a launch on `date` counts towards: one it went out under, open on that day. */
async function goalOn(ctx: MutationCtx, slop: Doc<"slops">, date: string): Promise<Doc<"goals"> | null> {
  const goals = await ctx.db
    .query("goals")
    .withIndex("by_user", (q) => q.eq("userId", slop.userId))
    .order("desc")
    .collect();
  return (
    goals.find(
      (goal) => (goal.abandonedAt === null || goal.abandonedAt > slop._creationTime) && goalDayFor(goal, date) !== null,
    ) ?? null
  );
}

async function redate(ctx: MutationCtx, slop: Doc<"slops">, date: string): Promise<void> {
  const goal = await goalOn(ctx, slop, date);
  const goalDay = goal ? goalDayFor(goal, date) : null;
  await ctx.db.patch(slop._id, {
    launchDate: date,
    goalId: goal?._id ?? null,
    goalDay,
    goalLength: goal?.days ?? null,
  });
}

/** Puts one launch on `date`. The e2e tests backdate launches with it. */
export const moveLaunch = internalMutation({
  args: { slopId: v.id("slops"), date: v.string() },
  handler: async (ctx, { slopId, date }) => {
    if (!isIsoDate(date)) throw new Error(`Not a date: ${date}`);
    const slop = await ctx.db.get(slopId);
    if (!slop) throw new Error(`No slop ${slopId}.`);
    await redate(ctx, slop, date);
  },
});

/**
 * Moves launches from before UTC days onto the UTC day they went out (their
 * `raceDate`). Only lists them unless `apply` is set; `username` keeps it to
 * one maker's launches.
 */
export const toUtcDays = internalMutation({
  args: { username: v.optional(v.string()), apply: v.optional(v.boolean()) },
  handler: async (ctx, { username, apply }) => {
    let slops: Doc<"slops">[];
    if (username) {
      const user = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", username.toLowerCase()))
        .unique();
      if (!user) throw new Error(`No user @${username}.`);
      slops = await ctx.db
        .query("slops")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .collect();
    } else {
      slops = await ctx.db.query("slops").collect();
    }
    const moved = [];
    for (const slop of slops) {
      if (slop.launchDate === slop.raceDate) continue;
      if (apply) await redate(ctx, slop, slop.raceDate);
      moved.push({ slopId: slop._id, name: slop.name, from: slop.launchDate, to: slop.raceDate });
    }
    return { applied: apply === true, moved };
  },
});
