import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, query, type QueryCtx } from "./_generated/server";
import { readerFor } from "./lib/auth";
import { toCards } from "./lib/shape";
import { addDays } from "../app/lib/dates";

/**
 * Slop of the day. Every UTC day is one race: the launches of that day,
 * ranked by net votes (private downvotes count against). Ties go to more
 * updates, then more feedback, then the earlier launch. A cron crowns the
 * winner just after midnight UTC, and the badge never changes after that.
 */

export function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function net(slop: Doc<"slops">): number {
  return slop.upvotes - slop.downvotes;
}

export async function rankDay(ctx: QueryCtx, date: string): Promise<Doc<"slops">[]> {
  const slops = await ctx.db
    .query("slops")
    .withIndex("by_race_date", (q) => q.eq("raceDate", date))
    .collect();
  return slops
    .filter((slop) => !slop.hidden)
    .sort(
      (a, b) =>
        net(b) - net(a) ||
        b.updateCount - a.updateCount ||
        b.commentCount - a.commentCount ||
        a._creationTime - b._creationTime,
    );
}

export const day = query({
  args: { date: v.string(), limit: v.optional(v.number()), asUser: v.optional(v.id("users")) },
  handler: async (ctx, { date, limit, asUser }) => {
    const reader = await readerFor(ctx, asUser);
    const ranking = await rankDay(ctx, date);
    const crowned = await ctx.db
      .query("dailyWinners")
      .withIndex("by_date", (q) => q.eq("date", date))
      .unique();
    return {
      date,
      final: date < utcToday(),
      winnerId: crowned?.slopId ?? null,
      items: await toCards(ctx, limit ? ranking.slice(0, limit) : ranking, reader),
    };
  },
});

/** The most recent slop of the day, if any. */
export const champion = query({
  args: { asUser: v.optional(v.id("users")) },
  handler: async (ctx, { asUser }) => {
    const reader = await readerFor(ctx, asUser);
    const recent = await ctx.db.query("dailyWinners").withIndex("by_date").order("desc").take(14);
    for (const winner of recent) {
      const slop = winner.slopId ? await ctx.db.get(winner.slopId) : null;
      if (!slop || slop.hidden) continue;
      const [card] = await toCards(ctx, [slop], reader);
      if (card) return { date: winner.date, item: card };
    }
    return null;
  },
});

/** Crowns yesterday's winner (cron). Needs at least one net upvote. */
export const crown = internalMutation({
  args: { date: v.optional(v.string()) },
  handler: async (ctx, { date }) => {
    const target = date ?? addDays(utcToday(), -1);
    const existing = await ctx.db
      .query("dailyWinners")
      .withIndex("by_date", (q) => q.eq("date", target))
      .unique();
    if (existing) return;
    // NSFW slops race, but the badge (and its promotion) goes to a safe one.
    const [leader] = (await rankDay(ctx, target)).filter((slop) => !slop.nsfw);
    const winner = leader && net(leader) > 0 ? leader : null;
    await ctx.db.insert("dailyWinners", { date: target, slopId: winner?._id ?? null });
    if (!winner) return;
    await ctx.db.patch(winner._id, { slopOfTheDay: target });
    await ctx.db.insert("notifications", {
      userId: winner.userId,
      kind: "slop_of_the_day",
      slopId: winner._id,
      actorId: null,
      amount: null,
      readAt: null,
    });
  },
});
