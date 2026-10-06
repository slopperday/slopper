import { mutation, query } from "./_generated/server";
import { viewer } from "./lib/auth";
import { publicUser } from "./lib/shape";

/**
 * Live notifications for the signed-in person: upvotes, feedback, kudos,
 * pledges and slop of the day wins. The browser subscribes with its own
 * token, so the bell updates the moment something happens.
 */

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const user = await viewer(ctx);
    if (!user) return 0;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", user._id).eq("readAt", null))
      .take(100);
    return unread.length;
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const user = await viewer(ctx);
    if (!user) return [];
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(200);
    rows.sort((a, b) => b._creationTime - a._creationTime);
    const items = [];
    for (const row of rows.slice(0, 50)) {
      const slop = await ctx.db.get(row.slopId);
      if (!slop) continue;
      const actor = row.actorId ? await ctx.db.get(row.actorId) : null;
      items.push({
        id: row._id,
        kind: row.kind,
        createdAt: row._creationTime,
        read: row.readAt !== null,
        amount: row.amount,
        actor: actor ? publicUser(actor) : null,
        slop: { name: slop.name, slug: slop.slug, launchLabel: slop.launchLabel, slopOfTheDay: slop.slopOfTheDay },
        ownerUsername: user.username,
      });
    }
    return items;
  },
});

export const markAllRead = mutation({
  args: {},
  handler: async (ctx) => {
    const user = await viewer(ctx);
    if (!user) return;
    const unread = await ctx.db
      .query("notifications")
      .withIndex("by_user_read", (q) => q.eq("userId", user._id).eq("readAt", null))
      .take(500);
    const now = Date.now();
    for (const row of unread) await ctx.db.patch(row._id, { readAt: now });
  },
});
