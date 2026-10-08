import { v } from "convex/values";
import { internalMutation, internalQuery, mutation } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { slopPath } from "../app/lib/display";
import { notificationText } from "../app/lib/notifications";

/**
 * Browser notifications (Web Push). The app server stores each browser's
 * subscription; `notify` schedules a send for every new notification, and
 * `pushSend.deliver` encrypts it for each browser and posts it to the
 * browser's push service.
 */

/** Browsers per person. Signing in on another drops the oldest. */
export const MAX_BROWSERS = 10;

export const subscribe = mutation({
  args: { userId: v.id("users"), endpoint: v.string(), p256dh: v.string(), auth: v.string() },
  handler: async (ctx, { userId, endpoint, p256dh, auth }) => {
    await requireServer(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    // A browser belongs to whoever turned notifications on in it last.
    if (existing) {
      await ctx.db.patch(existing._id, { userId, p256dh, auth });
      return;
    }
    await ctx.db.insert("pushSubscriptions", { userId, endpoint, p256dh, auth });
    const browsers = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const oldest of browsers.slice(0, Math.max(0, browsers.length - MAX_BROWSERS))) {
      await ctx.db.delete(oldest._id);
    }
  },
});

export const unsubscribe = mutation({
  args: { userId: v.id("users"), endpoint: v.string() },
  handler: async (ctx, { userId, endpoint }) => {
    await requireServer(ctx);
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing?.userId === userId) await ctx.db.delete(existing._id);
  },
});

/** What a notification says and which browsers get it. Null when there's nothing to send. */
export const delivery = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const notification = await ctx.db.get(notificationId);
    if (!notification) return null;
    const [owner, slop, actor, browsers] = await Promise.all([
      ctx.db.get(notification.userId),
      ctx.db.get(notification.slopId),
      notification.actorId ? ctx.db.get(notification.actorId) : null,
      ctx.db
        .query("pushSubscriptions")
        .withIndex("by_user", (q) => q.eq("userId", notification.userId))
        .take(MAX_BROWSERS),
    ]);
    if (!owner || !slop || browsers.length === 0) return null;
    return {
      subscriptions: browsers.map(({ endpoint, p256dh, auth }) => ({ endpoint, keys: { p256dh, auth } })),
      message: {
        title: "Slopper",
        body: notificationText({
          kind: notification.kind,
          actorUsername: actor?.username ?? null,
          slop,
          amount: notification.amount,
        }),
        url: slopPath(owner.username, slop.slug),
        // One notification per launch on screen: a newer one replaces it.
        tag: slop._id,
      },
    };
  },
});

/** The push service says this browser unsubscribed or expired. */
export const forget = internalMutation({
  args: { endpoint: v.string() },
  handler: async (ctx, { endpoint }) => {
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_endpoint", (q) => q.eq("endpoint", endpoint))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
  },
});
