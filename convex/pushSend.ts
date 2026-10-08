"use node";

import { buildPushPayload } from "@block65/webcrypto-web-push";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

const TIMEOUT_MS = 10_000;
/** Browsers that are off when it's sent still get it if they're back within a day. */
const TTL_SECONDS = 86_400;

/**
 * Sends one notification to each browser its owner turned them on in,
 * encrypted for each (RFC 8291) and signed with Slopper's VAPID key
 * (RFC 8292). Browser notifications are off until VAPID_PUBLIC_KEY and
 * VAPID_PRIVATE_KEY are set on Convex (`vp run vapid`). Runs in Node for
 * its Web Crypto.
 */
export const deliver = internalAction({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const vapid = {
      publicKey: process.env.VAPID_PUBLIC_KEY,
      privateKey: process.env.VAPID_PRIVATE_KEY,
      // How push services reach us about problems.
      subject: process.env.VAPID_SUBJECT ?? "mailto:hello@slopper.day",
    };
    if (!vapid.publicKey || !vapid.privateKey) return;
    const delivery = await ctx.runQuery(internal.push.delivery, { notificationId });
    if (!delivery) return;

    const results = await Promise.allSettled(
      delivery.subscriptions.map(async (subscription) => {
        const { headers, body } = await buildPushPayload(
          { data: delivery.message, options: { ttl: TTL_SECONDS, urgency: "normal" } },
          { ...subscription, expirationTime: null },
          vapid,
        );
        const response = await fetch(subscription.endpoint, {
          method: "POST",
          headers,
          body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // Gone for good: the person turned notifications off, or it expired.
        if (response.status === 404 || response.status === 410) {
          await ctx.runMutation(internal.push.forget, { endpoint: subscription.endpoint });
        } else if (!response.ok) {
          throw new Error(`${new URL(subscription.endpoint).host} answered ${response.status}`);
        }
      }),
    );
    for (const result of results) {
      if (result.status === "rejected") console.error("Browser notification failed", result.reason);
    }
  },
});
