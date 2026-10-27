import type { MutationCtx } from "../_generated/server";

/**
 * Fixed-window spending counters for the public ingest endpoints. The events
 * and recordings routes are open to anyone who can send an Origin header, so
 * a flood must hit a ceiling here rather than the deployment's storage and
 * function budget. `take` says how much of `amount` fits under `cap` in the
 * current window and spends that much — a mutation's transaction keeps the
 * count honest, and a flood merely contends on the row until its window ends.
 */

export const INGEST_LIMITS = {
  /** Attempts across both endpoints, including malformed, empty and refused uploads. */
  requestsPerMinute: 10_000,
  requestsPerDay: 1_000_000,
  /** Shared by browsers at one address; comfortably above the SDK's normal send rate. */
  requestsPerAddressPerMinute: 600,
  /**
   * Events the whole deployment takes per minute, and per UTC day. An honest
   * busy minute is a few thousand; a flood hits the ceiling and keeps the
   * rest, while the shared counter row slows the flood down as it fights
   * over it.
   */
  eventsPerMinute: 20_000,
  eventsPerDay: 2_000_000,
  /** Events one distinct id may send per UTC day: far past any honest browser. */
  eventsPerDistinctIdPerDay: 2_000,
  /** `$identify` merges into one account per UTC day: one per sign-in, so a handful. */
  mergesPerAccountPerDay: 10,
  /** Recording bytes the whole deployment takes per UTC day, and chunks per minute. */
  replayBytesPerDay: 10 * 1024 * 1024 * 1024,
  replayChunksPerMinute: 6_000,
} as const;

/** How much of `amount` still fits under `cap` in the window `key` counts. */
export async function take(
  ctx: MutationCtx,
  key: string,
  amount: number,
  cap: number,
  windowMs: number,
): Promise<number> {
  if (amount <= 0) return 0;
  const now = Date.now();
  const window = Math.floor(now / windowMs);
  const row = await ctx.db
    .query("counters")
    .withIndex("by_key_window", (q) => q.eq("key", key).eq("window", window))
    .unique();
  const used = row?.count ?? 0;
  const allowed = Math.min(amount, Math.max(0, cap - used));
  if (allowed > 0) {
    const fields = { count: used + allowed, expiresAt: (window + 1) * windowMs };
    if (row) await ctx.db.patch(row._id, fields);
    else await ctx.db.insert("counters", { key, window, ...fields });
  }
  return allowed;
}
