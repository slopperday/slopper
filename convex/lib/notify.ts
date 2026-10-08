import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

type NewNotification = Omit<Doc<"notifications">, "_id" | "_creationTime" | "readAt">;

/**
 * Records a notification for the bell. When its owner turned on browser
 * notifications, it also goes to their browsers, after this transaction
 * commits (`internal.pushSend.deliver`).
 */
export async function notify(ctx: MutationCtx, notification: NewNotification): Promise<Id<"notifications">> {
  const notificationId = await ctx.db.insert("notifications", { ...notification, readAt: null });
  const browser = await ctx.db
    .query("pushSubscriptions")
    .withIndex("by_user", (q) => q.eq("userId", notification.userId))
    .first();
  if (browser) await ctx.scheduler.runAfter(0, internal.pushSend.deliver, { notificationId });
  return notificationId;
}
