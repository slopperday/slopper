import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { flagConditionValidator, flagVariantValidator } from "../shared/flags";
import { propertyFilterValidator } from "../shared/insights/queries";
import { surveyKindValidator, surveyTargetValidator } from "../shared/surveys";
import { eventDayValidator, groupDayValidator, webDayValidator } from "./rollupValidators";
import { deviceValidator, properties, sourceValidator } from "./validators";

/**
 * Everything the component stores. Raw events are kept for a retention
 * period the app chooses (`maintenance.sweep`); people and their sessions
 * carry the counts and context that would otherwise mean scanning every
 * event, and daily rollups (`rollups.ts`) hold what the dashboards chart.
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
    /** What it's about, `type:id` (shared/events.ts `WireEvent.group`); absent for most events. */
    group: v.optional(v.string()),
  })
    // No index on the timestamp alone (each index is another copy of the table): scans and the
    // sweep go by name, person, session or group, and the latest-events list by creation time.
    .index("by_uuid", ["uuid"])
    .index("by_name_timestamp", ["name", "timestamp"])
    .index("by_person_timestamp", ["personId", "timestamp"])
    .index("by_session_timestamp", ["sessionId", "timestamp"])
    .index("by_group_timestamp", ["group", "timestamp"]),

  /**
   * Which days are rolled up. A day is only read from its rollup while
   * `rolledAt` is set: anything that changes the day's events or sessions
   * afterwards (a late batch, a session running past midnight, a merge, a
   * person forgotten) clears it, and the next roll-up does the day again.
   */
  rollupDays: defineTable({
    day: v.number(),
    rolledAt: v.union(v.number(), v.null()),
    /** When the day last changed after it ended. */
    changedAt: v.number(),
    /** Too busy to fit in rollup rows: read raw until it changes. */
    oversized: v.boolean(),
  })
    .index("by_day", ["day"])
    .index("by_rolled_day", ["rolledAt", "day"]),

  /** One row per rolled-up day: web analytics (shared/insights/rollups.ts `WebDay`). */
  webDays: defineTable(webDayValidator).index("by_day", ["day"]),

  /** Each event name's count and people per rolled-up day, and every event's under `ANY_EVENT`. */
  eventDays: defineTable(eventDayValidator).index("by_name_day", ["name", "day"]).index("by_day", ["day"]),

  /** Each group's page views and people per rolled-up day. */
  groupDays: defineTable(groupDayValidator).index("by_day", ["day"]),

  /** Every event name seen, for pickers: when it was first and last seen (to the hour). */
  eventDefinitions: defineTable({
    name: v.string(),
    firstSeenAt: v.number(),
    lastSeenAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_last_seen", ["lastSeenAt"]),

  /** Feature flags (shared/flags.ts says how one is evaluated). */
  flags: defineTable({
    key: v.string(),
    name: v.string(),
    description: v.string(),
    active: v.boolean(),
    variants: v.union(v.array(flagVariantValidator), v.null()),
    conditions: v.array(flagConditionValidator),
    payloads: v.record(v.string(), v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_active", ["active"]),

  /**
   * A session's recording: what it adds up to. Its chunks hold the rrweb
   * events, in file storage, as the browser sent them (shared/replay.ts).
   */
  recordings: defineTable({
    sessionId: v.string(),
    /** Who the first chunk came from; `forget` deletes recordings by any of a person's ids. */
    distinctId: v.string(),
    startedAt: v.number(),
    endedAt: v.number(),
    chunks: v.number(),
    bytes: v.number(),
    events: v.number(),
  })
    .index("by_session_id", ["sessionId"])
    .index("by_started", ["startedAt"])
    .index("by_distinct_id", ["distinctId"]),

  recordingChunks: defineTable({
    sessionId: v.string(),
    distinctId: v.string(),
    storageId: v.id("_storage"),
    startedAt: v.number(),
    endedAt: v.number(),
    bytes: v.number(),
    encoding: v.union(v.literal("gzip"), v.literal("identity")),
  })
    .index("by_session_started", ["sessionId", "startedAt"])
    .index("by_started", ["startedAt"])
    .index("by_distinct_id", ["distinctId"]),

  /** Surveys (shared/surveys.ts): one question each; answers are events, so results are worked out from them. */
  surveys: defineTable({
    key: v.string(),
    /** What admins call it; people only see the question. */
    name: v.string(),
    question: v.string(),
    kind: surveyKindValidator,
    choices: v.array(v.string()),
    followUp: v.union(v.string(), v.null()),
    target: surveyTargetValidator,
    status: v.union(v.literal("draft"), v.literal("running"), v.literal("stopped")),
    createdAt: v.number(),
    startedAt: v.union(v.number(), v.null()),
    endedAt: v.union(v.number(), v.null()),
  })
    .index("by_key", ["key"])
    .index("by_status", ["status"]),

  /** Experiments on flags with variants: results come from events, worked out when asked for. */
  experiments: defineTable({
    key: v.string(),
    name: v.string(),
    hypothesis: v.string(),
    flagKey: v.string(),
    /** What counts as converting: an event (on a page, with filters). */
    goal: v.object({ event: v.string(), filters: v.array(propertyFilterValidator) }),
    status: v.union(v.literal("draft"), v.literal("running"), v.literal("stopped")),
    startedAt: v.union(v.number(), v.null()),
    endedAt: v.union(v.number(), v.null()),
  })
    .index("by_key", ["key"])
    .index("by_flag", ["flagKey"]),
});
