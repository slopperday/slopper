import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/** Expired sessions, OAuth states and rate-limit windows. */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    for (const table of ["sessions", "oauthStates"] as const) {
      const expired = await ctx.db
        .query(table)
        .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
        .take(500);
      for (const row of expired) await ctx.db.delete(row._id);
    }
    const windows = await ctx.db.query("rateLimits").order("asc").take(500);
    for (const row of windows) {
      if (now - row._creationTime > 2 * 86_400_000) await ctx.db.delete(row._id);
    }
  },
});

const crons = cronJobs();

// Just after midnight UTC, yesterday's race is over: crown its winner.
crons.daily("crown slop of the day", { hourUTC: 0, minuteUTC: 1 }, internal.race.crown, {});
crons.daily("sweep expired rows", { hourUTC: 3, minuteUTC: 0 }, internal.crons.sweep, {});
// Each person's digest goes out at 9am their time, so check every hour.
crons.hourly("email digests", { minuteUTC: 0 }, internal.digest.run, {});
crons.daily("sweep old analytics", { hourUTC: 3, minuteUTC: 30 }, internal.analytics.sweep, {});

export default crons;
