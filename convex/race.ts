import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";
import { internalMutation, type MutationCtx, query, type QueryCtx } from "./_generated/server";
import { readerFor } from "./lib/auth";
import { notify } from "./lib/notify";
import { isHidden, toCards } from "./lib/shape";
import { addDays, formatDay, utcDate } from "../app/lib/dates";
import { plural } from "../app/lib/display";
import { LIMITS } from "../app/lib/model";

/**
 * Slop of the day. Every UTC day is one race: the launches of that day,
 * ranked by the net votes cast on that day (private downvotes count
 * against). Ties go to more updates, then more feedback, then the earlier
 * launch. A cron crowns the winner just after midnight UTC, and the badge
 * never changes after that. The winner also goes slopcessful, one of the
 * ways to earn it (see ROADMAP.md).
 *
 * Every vote counts on the slop, whenever it's cast. The race only counts
 * the ones `countsInRace` lets through, so it's harder to game.
 */

export function utcToday(): string {
  return utcDate(Date.now());
}

/** The votes a slop's race counts. Slops from before race tallies use their totals. */
export function raceTally(slop: Doc<"slops">): { upvotes: number; downvotes: number } {
  return { upvotes: slop.raceUpvotes ?? slop.upvotes, downvotes: slop.raceDownvotes ?? slop.downvotes };
}

function net(slop: Doc<"slops">): number {
  const { upvotes, downvotes } = raceTally(slop);
  return upvotes - downvotes;
}

/** Whether a vote is in its slop's race tally. Votes from before `inRace` are if cast that day. */
export function countedInRace(vote: Doc<"votes">, slop: Doc<"slops">): boolean {
  return vote.inRace ?? vote.castOn === slop.raceDate;
}

/**
 * Whether a vote cast now counts in its slop's race, on top of the slop's
 * total. The race only counts votes cast on its day, and not ones:
 * - from accounts less than `LIMITS.raceVoterAge` old, so made-up accounts
 *   can't swing it;
 * - that are downvotes from a maker racing the same day, who can't push
 *   rivals down;
 * - that trade upvotes: when two makers racing the same day upvote each
 *   other, neither upvote counts. The first one comes out of its tally here.
 */
export async function countsInRace(
  ctx: MutationCtx,
  voter: Doc<"users">,
  slop: Doc<"slops">,
  value: 1 | -1,
  now: number,
): Promise<boolean> {
  const today = utcDate(now);
  if (slop.raceDate !== today) return false;
  if (now - voter._creationTime < LIMITS.raceVoterAge) return false;
  // Read through the voter's own slops: a read of the whole day's race would
  // conflict with every launch going out at the same time.
  const racing = await ctx.db
    .query("slops")
    .withIndex("by_user", (q) => q.eq("userId", voter._id))
    .filter((q) => q.eq(q.field("raceDate"), today))
    .collect();
  if (racing.length === 0) return true;
  if (value === -1) return false;
  const theirs = await ctx.db
    .query("votes")
    .withIndex("by_user_cast_on", (q) => q.eq("userId", slop.userId).eq("castOn", today))
    .collect();
  let traded = false;
  for (const vote of theirs) {
    const mine = racing.find((own) => own._id === vote.slopId);
    if (!mine || vote.value !== 1) continue;
    traded = true;
    if (!countedInRace(vote, mine)) continue;
    await ctx.db.patch(vote._id, { inRace: false });
    await ctx.db.patch(mine._id, { raceUpvotes: raceTally(mine).upvotes - 1 });
  }
  return !traded;
}

export async function rankDay(ctx: QueryCtx, date: string): Promise<Doc<"slops">[]> {
  const slops = await ctx.db
    .query("slops")
    .withIndex("by_race_date", (q) => q.eq("raceDate", date))
    .collect();
  return slops
    .filter((slop) => !isHidden(slop))
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
    // The query is public (live subscriptions), so no caller — page or
    // stranger with the deployment URL — asks for more than a day could
    // reasonably hold.
    const cap = Math.min(limit ?? 500, 500);
    return {
      date,
      final: date < utcToday(),
      winnerId: crowned?.slopId ?? null,
      items: await toCards(ctx, ranking.slice(0, cap), reader),
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
      if (!slop || isHidden(slop)) continue;
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
    // Winning the day makes a slop slopcessful; nobody can declare it.
    const now = Date.now();
    const { upvotes } = raceTally(winner);
    const note = `Won slop of the day on ${formatDay(target)} with ${plural(upvotes, "upvote", "upvotes")}.`;
    await ctx.db.patch(winner._id, {
      slopOfTheDay: target,
      slopcessfulAt: winner.slopcessfulAt ?? now,
      slopcessfulNote: note,
      updateCount: winner.updateCount + 1,
      lastActivityAt: now,
    });
    await ctx.db.insert("updates", {
      slopId: winner._id,
      userId: winner.userId,
      kind: "slopcessful",
      body: note,
      crossposts: [],
    });
    await notify(ctx, {
      userId: winner.userId,
      kind: "slop_of_the_day",
      slopId: winner._id,
      actorId: null,
      amount: null,
    });
  },
});
