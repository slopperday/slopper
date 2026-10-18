import { v } from "convex/values";

/** A property value: see shared/properties.ts, which validates what reaches these. */
export const propertyValue = v.union(v.string(), v.number(), v.boolean(), v.null(), v.array(v.string()));

export const properties = v.record(v.string(), propertyValue);

export const deviceTypeValidator = v.union(v.literal("desktop"), v.literal("mobile"), v.literal("tablet"));

export const deviceValidator = v.object({
  browser: v.union(v.string(), v.null()),
  browserVersion: v.union(v.string(), v.null()),
  os: v.union(v.string(), v.null()),
  osVersion: v.union(v.string(), v.null()),
  deviceType: v.union(deviceTypeValidator, v.null()),
});

export const channelValidator = v.union(
  v.literal("direct"),
  v.literal("search"),
  v.literal("social"),
  v.literal("email"),
  v.literal("paid"),
  v.literal("referral"),
  v.literal("internal"),
);

/** Where a session came from (shared/source.ts). */
export const sourceValidator = v.object({
  referrerDomain: v.union(v.string(), v.null()),
  utmSource: v.union(v.string(), v.null()),
  utmMedium: v.union(v.string(), v.null()),
  utmCampaign: v.union(v.string(), v.null()),
  channel: channelValidator,
});

/** One event as the HTTP endpoint or an app's server code hands it over (shared/events.ts). */
export const wireEventValidator = v.object({
  uuid: v.string(),
  name: v.string(),
  distinctId: v.string(),
  sessionId: v.union(v.string(), v.null()),
  timestamp: v.number(),
  path: v.union(v.string(), v.null()),
  properties,
  set: v.union(properties, v.null()),
  setOnce: v.union(properties, v.null()),
});

/** What the endpoint learned from the request itself, not from the SDK. */
export const requestContextValidator = v.object({
  device: deviceValidator,
  /** The site's own host, so a referrer from it counts as internal. */
  ownHost: v.union(v.string(), v.null()),
});
