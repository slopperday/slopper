import { ConvexError, v } from "convex/values";
import { mutation } from "./_generated/server";
import { requireServer } from "./lib/auth";
import { consume } from "./lib/rate";

/** Rate limits the app server enforces outside other mutations (API, MCP). */
export const hit = mutation({
  args: { key: v.string(), limit: v.number(), windowMs: v.number() },
  handler: async (ctx, { key, limit, windowMs }): Promise<boolean> => {
    await requireServer(ctx);
    try {
      await consume(ctx, key, limit, windowMs);
      return true;
    } catch (error) {
      if (error instanceof ConvexError) return false;
      throw error;
    }
  },
});
