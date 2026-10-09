import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { nextDigestAt } from "./lib/digest";
import type { DigestItem } from "../app/lib/digest";

/**
 * Daily digest emails. Every hour this picks the people whose 9am has come
 * (`nextDigestAt`), gathers their unread notifications since the last
 * digest, and hands them to `digestSend.deliver`, which renders the
 * emails (`app/emails/digest.tsx`) and sends them in one batch.
 * People with nothing new get no email; their next digest is tomorrow.
 *
 * Off until RESEND_API_KEY is set on Convex. APP_URL (Convex) is the site
 * the links point at.
 */

/** Resend's batch limit, and the free plan's daily cap. */
const BATCH = 100;
/** A digest never reaches back further than this, however long it's been. */
const MAX_WINDOW_MS = 2 * 86_400_000;

export const run = internalMutation({
  args: { now: v.optional(v.number()) },
  handler: async (ctx, args) => {
    if (!process.env.RESEND_API_KEY) return;
    const now = args.now ?? Date.now();
    const appUrl = process.env.APP_URL ?? "https://slopper.day";
    const due = await ctx.db
      .query("users")
      .withIndex("by_next_digest", (q) => q.gt("nextDigestAt", 0).lte("nextDigestAt", now))
      .take(BATCH);

    const emails = [];
    for (const user of due) {
      const next = nextDigestAt(user, now);
      if (!user.email || !user.emailToken || next === undefined) {
        await ctx.db.patch(user._id, { nextDigestAt: undefined });
        continue;
      }
      const since = Math.max(user.digestSentAt ?? 0, now - MAX_WINDOW_MS);
      const unread = await ctx.db
        .query("notifications")
        .withIndex("by_user_read", (q) => q.eq("userId", user._id).eq("readAt", null))
        .order("desc")
        .take(200);
      const items: DigestItem[] = [];
      for (const notification of unread) {
        if (notification._creationTime <= since) continue;
        const slop = await ctx.db.get(notification.slopId);
        if (!slop) continue;
        items.push({
          kind: notification.kind,
          slop: { id: slop._id, name: slop.name, launchLabel: slop.launchLabel, slug: slop.slug },
          amount: notification.amount,
        });
      }
      await ctx.db.patch(user._id, { nextDigestAt: next, ...(items.length > 0 ? { digestSentAt: now } : {}) });
      if (items.length === 0) continue;
      emails.push({
        to: user.email,
        username: user.username,
        items,
        unsubscribeUrl: new URL(`/unsubscribe/${user.emailToken}`, appUrl).href,
      });
    }

    if (emails.length > 0) {
      await ctx.scheduler.runAfter(0, internal.digestSend.deliver, {
        emails,
        appUrl,
        idempotencyKey: `digest-${now}`,
      });
    }
    // More people due than one batch holds: carry on straight away.
    if (due.length === BATCH) await ctx.scheduler.runAfter(0, internal.digest.run, { now });
  },
});
