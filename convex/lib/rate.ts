import { ConvexError } from "convex/values";
import type { MutationCtx } from "../_generated/server";

/**
 * Fixed-window rate limit. Throws once `key` has used up `limit` actions in
 * the current window. Mutations are transactions, so counts never race.
 */
export async function consume(ctx: MutationCtx, key: string, limit: number, windowMs: number): Promise<void> {
  const window = Math.floor(Date.now() / windowMs);
  const row = await ctx.db
    .query("rateLimits")
    .withIndex("by_key_window", (q) => q.eq("key", key).eq("window", window))
    .unique();
  if (row && row.count >= limit) throw new ConvexError("Slow down a little. Try again later.");
  if (row) await ctx.db.patch(row._id, { count: row.count + 1 });
  else await ctx.db.insert("rateLimits", { key, window, count: 1 });
}

/** `consume` as a question: false once the window's `limit` is spent, without throwing. */
export async function spent(ctx: MutationCtx, key: string, limit: number, windowMs: number): Promise<boolean> {
  try {
    await consume(ctx, key, limit, windowMs);
    return true;
  } catch (error) {
    if (error instanceof ConvexError) return false;
    throw error;
  }
}

/** Next value of a named sequence ("Slop #42"). */
export async function nextCounter(ctx: MutationCtx, name: string): Promise<number> {
  const row = await ctx.db
    .query("counters")
    .withIndex("by_name", (q) => q.eq("name", name))
    .unique();
  const value = (row?.value ?? 0) + 1;
  if (row) await ctx.db.patch(row._id, { value });
  else await ctx.db.insert("counters", { name, value });
  return value;
}
