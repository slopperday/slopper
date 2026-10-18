import { bucketStart } from "../../shared/insights/time";
import type { MutationCtx } from "../_generated/server";

/**
 * How long a change to a past day can go unwritten: one already marked this
 * recently isn't written again, which keeps busy days from conflicting on
 * their marker. `rollups.write` allows for it.
 */
export const CHANGE_RESOLUTION_MS = 60_000;

/**
 * Marks the days these moments fall on as changed, so their rollups stop
 * being read until the next roll-up does them again. Anything that writes
 * or deletes events or sessions calls it: today never has a rollup, so only
 * past days cost a lookup.
 */
export async function markChanged(ctx: MutationCtx, moments: Iterable<number>): Promise<void> {
  const now = Date.now();
  const today = bucketStart(now, "day");
  const days = new Set<number>();
  for (const at of moments) {
    const day = bucketStart(at, "day");
    if (day < today) days.add(day);
  }
  for (const day of days) {
    const marker = await ctx.db
      .query("rollupDays")
      .withIndex("by_day", (q) => q.eq("day", day))
      .unique();
    if (!marker) {
      await ctx.db.insert("rollupDays", { day, rolledAt: null, changedAt: now, oversized: false });
    } else if (marker.rolledAt !== null || marker.oversized || now - marker.changedAt >= CHANGE_RESOLUTION_MS) {
      await ctx.db.patch(marker._id, { rolledAt: null, changedAt: now, oversized: false });
    }
  }
}
