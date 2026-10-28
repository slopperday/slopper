import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query, type QueryCtx } from "./_generated/server";
import { captureFor } from "./analytics";
import { requireServer } from "./lib/auth";
import { LIMITS } from "../app/lib/model";
import { isHidden, publicUser } from "./lib/shape";
import { currentStreak, utcDate } from "../app/lib/dates";
import { goalEndDate, goalProgress, isGoalOpen } from "../app/lib/goal";

/** The goal a launch today counts towards, if any. */
export async function openGoal(ctx: QueryCtx, userId: Id<"users">, today: string): Promise<Doc<"goals"> | null> {
  const goals = await ctx.db
    .query("goals")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .order("desc")
    .take(5);
  return goals.find((goal) => isGoalOpen(goal, today)) ?? null;
}

export const open = query({
  args: { userId: v.id("users"), today: v.string() },
  handler: async (ctx, { userId, today }) => {
    await requireServer(ctx);
    return await openGoal(ctx, userId, today);
  },
});

export const create = mutation({
  args: {
    userId: v.id("users"),
    title: v.string(),
    target: v.number(),
    days: v.number(),
    startDate: v.string(),
    today: v.string(),
  },
  handler: async (
    ctx,
    { userId, today, ...input },
  ): Promise<{ ok: true; goal: Doc<"goals"> } | { ok: false; error: string }> => {
    await requireServer(ctx);
    // The same shape the form requires (app/.server/forms.ts validateGoal);
    // Convex-side, because a degenerate goal (target 0) would render as
    // instantly won in every list that reads one.
    const days = Number.isInteger(input.days) ? input.days : 0;
    const target = Number.isInteger(input.target) ? input.target : 0;
    if (days < 1 || days > LIMITS.goalDays || target < 1 || target > 1000 || input.title.length > 80) {
      return { ok: false, error: "That isn't a goal the form would accept." };
    }
    if (await openGoal(ctx, userId, today)) return { ok: false, error: "Finish or drop your current goal first." };
    const draft = { ...input, abandonedAt: null };
    const id = await ctx.db.insert("goals", { userId, ...draft, endDate: goalEndDate(draft) });
    const goal = await ctx.db.get(id);
    if (!goal) throw new Error("Goal vanished after insert");
    await captureFor(ctx, userId, { name: "goal set", properties: { days: goal.days, target: goal.target } });
    return { ok: true, goal };
  },
});

export const abandon = mutation({
  args: { userId: v.id("users"), goalId: v.id("goals") },
  handler: async (ctx, { userId, goalId }) => {
    await requireServer(ctx);
    const goal = await ctx.db.get(goalId);
    if (goal && goal.userId === userId && goal.abandonedAt === null) {
      await ctx.db.patch(goalId, { abandonedAt: Date.now() });
    }
  },
});

const STATUS_RANK = { won: 0, active: 1, upcoming: 2, ended: 3, abandoned: 4 } as const;

/** Everyone with a running goal, best run first. */
export const standings = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    const today = utcDate(Date.now());
    // The query is public and reads every open goal's every launch, so it is
    // bounded on both: far past anything honest, low enough that a stranger
    // looping the deployment URL can't make it scan the database.
    const goals = await ctx.db
      .query("goals")
      .withIndex("by_end", (q) => q.gte("endDate", today))
      .take(2_000);
    const rows = [];
    for (const goal of goals) {
      if (goal.abandonedAt !== null) continue;
      const user = await ctx.db.get(goal.userId);
      if (!user) continue;
      const slops = await ctx.db
        .query("slops")
        .withIndex("by_user", (q) => q.eq("userId", user._id))
        .take(2_000);
      const launches = slops
        .filter((slop) => !isHidden(slop))
        .map((slop) => ({ id: slop._id, name: slop.name, slug: slop.slug, launchDate: slop.launchDate }));
      if (!isGoalOpen(goal, today)) continue;
      rows.push({
        user: publicUser(user),
        progress: goalProgress(goal, launches, today),
        streak: currentStreak(
          launches.map((launch) => launch.launchDate),
          today,
        ),
      });
    }
    rows.sort(
      (a, b) =>
        STATUS_RANK[a.progress.status] - STATUS_RANK[b.progress.status] ||
        b.streak - a.streak ||
        b.progress.shipped / b.progress.goal.target - a.progress.shipped / a.progress.goal.target,
    );
    return limit ? rows.slice(0, limit) : rows;
  },
});
