import { Analytics } from "@slopperday/analytics/convex";
import type { Id } from "./_generated/dataModel";
import { components } from "./_generated/api";
import { internalMutation, type MutationCtx } from "./_generated/server";

/**
 * Slopper's first-party analytics (packages/analytics): events, people and
 * sessions live in this deployment, in the analytics component's own
 * tables, and nothing is sent anywhere else.
 */
export const analytics = new Analytics(components.analytics);

/** Raw events and sessions are kept a year; people not seen for a year go with them. */
export const RETENTION = { eventDays: 365, personDays: 365 } as const;

/**
 * What people do that matters most, captured where it happens rather than
 * in the browser, so blockers and closed tabs can't lose it. Signed-in
 * people's distinct id is their user id, which the browser identifies them
 * with too (app/root.tsx).
 */
export type ProductEvent =
  | { name: "signed up"; properties: { provider: string } }
  | { name: "slop launched"; properties: { category: string; relaunch: boolean; goalDay: number | null } }
  | { name: "voted"; properties: { value: 1 | -1 | 0 } }
  | { name: "pledged" }
  | { name: "update posted"; properties: { kind: string } }
  | { name: "goal set"; properties: { days: number; target: number } };

export async function captureFor(ctx: MutationCtx, userId: Id<"users">, event: ProductEvent): Promise<void> {
  await analytics.capture(ctx, {
    name: event.name,
    distinctId: userId,
    properties: "properties" in event ? event.properties : {},
    identified: true,
  });
}

/** Deletes what's past `RETENTION`, daily (convex/crons.ts). */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    await analytics.sweep(ctx, RETENTION);
  },
});
