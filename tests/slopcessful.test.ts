// @vitest-environment edge-runtime
import { describe, expect, it } from "vite-plus/test";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { convexApp } from "./convexApp";
import { checkedLaunch } from "./launchFixtures";

/** Winners with distinct breakout times. */
async function hallOfFame(count = 5) {
  const t = convexApp();
  const server = t.withIdentity({ subject: "server" });
  const { userId } = await server.mutation(api.users.upsertFromIdentity, {
    provider: "dev",
    providerId: "maker",
    preferredUsername: "maker",
    displayName: "Maker",
    avatarUrl: null,
    timeZone: "UTC",
  });
  const { slopId } = await checkedLaunch(server, {
    userId,
    input: {
      name: "Winner",
      tagline: "A hall-of-fame fixture",
      description: "",
      category: "games",
      links: [],
      screenshots: [],
      madeWith: [],
    },
    launchNote: "Launched",
  });
  const ids = await t.run(async (ctx) => {
    const template = await ctx.db.get(slopId);

    if (!template) throw new Error("Missing fixture slop");

    const { _id, _creationTime, ...fields } = template;
    const winners: Id<"slops">[] = [];

    for (let index = 1; index <= count; index++) {
      winners.push(await ctx.db.insert("slops", { ...fields, slug: `winner-${index}`, slopcessfulAt: index }));
    }

    return winners.reverse();
  });

  return { t, userId, ids };
}

describe("the public slopcessful hall of fame", () => {
  it("caps anonymous database reads and card expansion before returning the newest 100 winners", async () => {
    const { t, ids } = await hallOfFame(105);
    const { items, metrics } = await t.query(async (ctx) => {
      const items = await ctx.runQuery(api.slops.slopcessful, { limit: Number.MAX_VALUE });
      return { items, metrics: await ctx.meta.getTransactionMetrics() };
    });

    expect(items.map((item) => item.slop.id)).toEqual(ids.slice(0, 100));
    // 100 winning slops and their one shared owner; no reads for excess rows.
    expect(metrics.documentsRead.used).toBeLessThanOrEqual(101);
    expect((await t.query(api.slops.slopcessful, {})).map((item) => item.slop.id)).toEqual(ids.slice(0, 100));
  });

  it.each([
    [3, 3],
    [3.9, 3],
    [0, 0],
    [-1, 0],
    [-Number.MAX_VALUE, 0],
  ])("normalizes limit %s to %s results", async (limit, count) => {
    const { t, ids } = await hallOfFame();
    const items = await t.query(api.slops.slopcessful, { limit });

    expect(items.map((item) => item.slop.id)).toEqual(ids.slice(0, count));
  });

  it.each([NaN, Infinity, -Infinity])("rejects a non-finite limit %s", async (limit) => {
    const t = convexApp();

    await expect(t.query(api.slops.slopcessful, { limit })).rejects.toThrow("Limit must be finite");
  });

  it("keeps hidden and mature winners out of anonymous results", async () => {
    const { t, userId, ids } = await hallOfFame();
    await t.run(async (ctx) => {
      await ctx.db.patch(ids[0], { hidden: true });
      await ctx.db.patch(ids[1], { nsfw: true });
    });
    const items = await t.query(api.slops.slopcessful, { limit: 3, asUser: userId });

    expect(items.map((item) => item.slop.id)).toEqual([ids[2]]);
  });
});
