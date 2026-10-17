import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { readerFor } from "./lib/auth";
import { publicUser, toCards } from "./lib/shape";
import { rankDay, utcToday } from "./race";
import { rankHot } from "../app/lib/ranking";

/** The live home page: today's race, the ticker and recent updates. */
export const feed = query({
  args: { asUser: v.optional(v.id("users")), since: v.number() },
  handler: async (ctx, { asUser, since }) => {
    const reader = await readerFor(ctx, asUser);
    const race = await rankDay(ctx, utcToday());
    const week = (
      await ctx.db
        .query("slops")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", since))
        .order("desc")
        .take(200)
    ).filter((slop) => !slop.hidden);

    const recentUpdates = await ctx.db.query("updates").order("desc").take(40);
    const updates = [];
    const slops = new Map<Id<"slops">, Doc<"slops"> | null>();
    const owners = new Map<Id<"users">, Doc<"users"> | null>();
    for (const update of recentUpdates) {
      if (update.kind === "launch" || updates.length >= 8) continue;
      if (!slops.has(update.slopId)) slops.set(update.slopId, await ctx.db.get(update.slopId));
      if (!owners.has(update.userId)) owners.set(update.userId, await ctx.db.get(update.userId));
      const slop = slops.get(update.slopId);
      const owner = owners.get(update.userId);
      if (!slop || !owner || slop.hidden || slop.nsfw) continue;
      updates.push({
        update: {
          id: update._id,
          kind: update.kind,
          body: update.body,
          version: update.version ?? null,
          createdAt: update._creationTime,
        },
        slop: { name: slop.name, slug: slop.slug },
        owner: publicUser(owner),
      });
    }

    return {
      race: await toCards(ctx, race.slice(0, 10), reader),
      // An empty race still leaves something to look at: the week's best.
      wall: race.length > 0 ? [] : await toCards(ctx, rankHot(week, new Date()).slice(0, 6), reader),
      ticker: await toCards(ctx, week.slice(0, 14), reader),
      updates,
    };
  },
});
