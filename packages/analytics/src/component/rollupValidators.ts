import { v } from "convex/values";

/** Rollup rows as stored; their shapes are `WebDay`, `EventDay` and `GroupDay` in shared/insights/rollups.ts. */

const webDayRows = v.array(v.object({ value: v.string(), count: v.number(), people: v.array(v.number()) }));

export const webDayValidator = v.object({
  day: v.number(),
  people: v.array(v.string()),
  visitors: v.array(v.number()),
  sessions: v.number(),
  pageviews: v.number(),
  durationMs: v.number(),
  bounces: v.number(),
  breakdowns: v.object({
    pages: webDayRows,
    entryPages: webDayRows,
    exitPages: webDayRows,
    channels: webDayRows,
    referrers: webDayRows,
    utmSources: webDayRows,
    utmCampaigns: webDayRows,
    browsers: webDayRows,
    operatingSystems: webDayRows,
    devices: webDayRows,
    countries: webDayRows,
  }),
});

export const eventDayValidator = v.object({
  day: v.number(),
  name: v.string(),
  count: v.number(),
  people: v.array(v.string()),
});

export const groupDayValidator = v.object({
  day: v.number(),
  group: v.string(),
  count: v.number(),
  people: v.array(v.string()),
});
