import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

/** Rows deleted per transaction; a full page means the sweep keeps going. */
const PAGE = 500;

/**
 * Expired sessions, OAuth states, update reservations and rate-limit windows.
 * Deletes a page and schedules itself again while pages stay full: a flood of OAuth starts or
 * rotating API-quota buckets can make rows faster than one page a day.
 */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    let more = false;
    for (const table of ["sessions", "oauthStates", "updateReservations"] as const) {
      const expired = await ctx.db
        .query(table)
        .withIndex("by_expiry", (q) => q.lt("expiresAt", now))
        .take(PAGE);
      for (const row of expired) await ctx.db.delete(row._id);
      if (expired.length === PAGE) more = true;
    }
    const windows = await ctx.db.query("rateLimits").order("asc").take(PAGE);
    for (const row of windows) {
      if (now - row._creationTime > 2 * 86_400_000) await ctx.db.delete(row._id);
    }
    if (windows.length === PAGE) more = true;
    if (more) await ctx.scheduler.runAfter(0, internal.crons.sweep, {});
  },
});

const crons = cronJobs();

// Just after midnight UTC, yesterday's race is over: crown its winner.
crons.daily("crown slop of the day", { hourUTC: 0, minuteUTC: 1 }, internal.race.crown, {});
crons.daily("sweep expired rows", { hourUTC: 3, minuteUTC: 0 }, internal.crons.sweep, {});
// Each person's digest goes out at 9am their time, so check every hour.
crons.hourly("email digests", { minuteUTC: 0 }, internal.digest.run, {});
crons.daily("sweep old analytics", { hourUTC: 3, minuteUTC: 30 }, internal.analytics.sweep, {});
// After the sweep, and late enough that yesterday's sessions have ended: roll up yesterday's analytics.
crons.daily("roll up analytics", { hourUTC: 4, minuteUTC: 0 }, internal.analytics.rollUp, {});
// Uploads nothing ever attached wait out a grace period, then go.
crons.interval("sweep never-attached uploads", { minutes: 15 }, internal.media.sweepUnattached, {});
// Releases the app server never finished get their check and auto-post after all.
crons.interval(
  "finish scheduled releases the app server missed",
  { minutes: 15 },
  internal.schedule.tellUnfinished,
  {},
);

export default crons;
