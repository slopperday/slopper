import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { deviceValidator, properties, sourceValidator } from "./validators";

/**
 * Everything the component stores. Raw events are kept for a retention
 * period the app chooses (`maintenance.sweep`); people and their sessions
 * are what the dashboards read most, so they carry the counts and context
 * that would otherwise mean scanning every event.
 */
export default defineSchema({
  /**
   * People, anonymous until they sign in. One person can have many distinct
   * ids (every browser they used before signing in, and their account).
   */
  persons: defineTable({
    createdAt: v.number(),
    lastSeenAt: v.number(),
    /** Linked to an account by `$identify`. Two identified people are never merged. */
    identified: v.boolean(),
    properties,
    /** Where they first came from, from their first session. */
    initialSource: v.union(sourceValidator, v.null()),
    initialPath: v.union(v.string(), v.null()),
    /**
     * Set while a merge moves this person's events and sessions to another
     * (`persons.finishMerge`), which deletes this row when it's done.
     */
    mergedInto: v.optional(v.id("persons")),
  })
    .index("by_created", ["createdAt"])
    .index("by_last_seen", ["lastSeenAt"]),

  /** Which person each distinct id belongs to. */
  distinctIds: defineTable({
    distinctId: v.string(),
    personId: v.id("persons"),
  })
    .index("by_distinct_id", ["distinctId"])
    .index("by_person", ["personId"]),

  /**
   * One browser session: events less than 30 minutes apart (the SDK decides).
   * Kept up to date as its events arrive, so web analytics read sessions,
   * not events.
   */
  sessions: defineTable({
    sessionId: v.string(),
    personId: v.id("persons"),
    distinctId: v.string(),
    startedAt: v.number(),
    endedAt: v.number(),
    events: v.number(),
    pageviews: v.number(),
    /** Clicks, submissions and changes: a session with none of them and one page bounced. */
    interactions: v.number(),
    entryPath: v.union(v.string(), v.null()),
    exitPath: v.union(v.string(), v.null()),
    source: sourceValidator,
    device: deviceValidator,
    /** ISO 3166 code, when the app passes one along (it never comes from an IP address here). */
    country: v.union(v.string(), v.null()),
    viewportWidth: v.union(v.number(), v.null()),
  })
    .index("by_session_id", ["sessionId"])
    .index("by_started", ["startedAt"])
    .index("by_ended", ["endedAt"])
    .index("by_person_started", ["personId", "startedAt"]),

  events: defineTable({
    /** From the sender, to store a batch sent twice only once. */
    uuid: v.string(),
    name: v.string(),
    distinctId: v.string(),
    personId: v.id("persons"),
    sessionId: v.union(v.string(), v.null()),
    timestamp: v.number(),
    path: v.union(v.string(), v.null()),
    properties,
  })
    .index("by_uuid", ["uuid"])
    .index("by_timestamp", ["timestamp"])
    .index("by_name_timestamp", ["name", "timestamp"])
    .index("by_person_timestamp", ["personId", "timestamp"])
    .index("by_session_timestamp", ["sessionId", "timestamp"]),
});
