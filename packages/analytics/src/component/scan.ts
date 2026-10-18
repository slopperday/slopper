import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { DEFINITION_RESOLUTION_MS } from "./lib/ingest";
import { type Page, pageArgs, pageByKey } from "./lib/paging";
import { deviceValidator, properties, sourceValidator } from "./validators";

/**
 * Pages of events and sessions in a time range, for the insights engine
 * (src/convex/scanner.ts), which reads them page by page from an action
 * and aggregates as it goes. Each page is its own transaction, so a long
 * range never hits a query's read limits.
 */

const rangeArgs = { from: v.number(), to: v.number(), ...pageArgs };

const scanEvent = v.object({
  name: v.string(),
  distinctId: v.string(),
  personId: v.id("persons"),
  sessionId: v.union(v.string(), v.null()),
  timestamp: v.number(),
  path: v.union(v.string(), v.null()),
  properties,
  group: v.union(v.string(), v.null()),
});

const scanSession = v.object({
  sessionId: v.string(),
  personId: v.id("persons"),
  startedAt: v.number(),
  endedAt: v.number(),
  pageviews: v.number(),
  interactions: v.number(),
  entryPath: v.union(v.string(), v.null()),
  exitPath: v.union(v.string(), v.null()),
  source: sourceValidator,
  device: deviceValidator,
  country: v.union(v.string(), v.null()),
});

const scanPerson = v.object({ identified: v.boolean(), createdAt: v.number(), lastSeenAt: v.number() });

const page = <Item extends typeof scanEvent | typeof scanSession | typeof scanPerson>(item: Item) =>
  v.object({ page: v.array(item), isDone: v.boolean(), continueCursor: v.string() });

/**
 * One event's occurrences in the range, oldest first. With `group`, only
 * that group's events: of that name, or every one when `name` is null.
 * Without a group, every event is read name by name (`eventNames`).
 */
export const events = query({
  args: { name: v.union(v.string(), v.null()), group: v.optional(v.string()), ...rangeArgs },
  returns: page(scanEvent),
  handler: async (ctx, { name, group, from, to, cursor, numItems }) => {
    const events = () => ctx.db.query("events");
    let result: Page<Doc<"events">>;
    if (group !== undefined) {
      result = await pageByKey<Doc<"events">>({
        cursor,
        numItems,
        key: (event) => event.timestamp,
        sameKey: (at) =>
          events()
            .withIndex("by_group_timestamp", (q) =>
              q.eq("group", group).eq("timestamp", at.key).gt("_creationTime", at.created),
            )
            .filter((q) => (name === null ? true : q.eq(q.field("name"), name))),
        rest: (at) =>
          events()
            .withIndex("by_group_timestamp", (q) =>
              at
                ? q.eq("group", group).gt("timestamp", at.key).lt("timestamp", to)
                : q.eq("group", group).gte("timestamp", from).lt("timestamp", to),
            )
            .filter((q) => (name === null ? true : q.eq(q.field("name"), name))),
      });
    } else if (name === null) {
      throw new Error("Every event in a range is read name by name: scan.eventNames lists them.");
    } else {
      result = await pageByKey<Doc<"events">>({
        cursor,
        numItems,
        key: (event) => event.timestamp,
        sameKey: (at) =>
          events().withIndex("by_name_timestamp", (q) =>
            q.eq("name", name).eq("timestamp", at.key).gt("_creationTime", at.created),
          ),
        rest: (at) =>
          events().withIndex("by_name_timestamp", (q) =>
            at
              ? q.eq("name", name).gt("timestamp", at.key).lt("timestamp", to)
              : q.eq("name", name).gte("timestamp", from).lt("timestamp", to),
          ),
      });
    }
    return {
      page: result.page.map((event) => ({
        name: event.name,
        distinctId: event.distinctId,
        personId: event.personId,
        sessionId: event.sessionId,
        timestamp: event.timestamp,
        path: event.path,
        properties: event.properties,
        group: event.group ?? null,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/**
 * The names of every event that happened in the range: those to read one
 * by one for every event. A name's last-seen time is written at most
 * `DEFINITION_RESOLUTION_MS` behind its latest event, and its first-seen
 * time exactly, so none is missed.
 */
export const eventNames = query({
  args: { from: v.number(), to: v.number() },
  returns: v.array(v.string()),
  handler: async (ctx, { from, to }) => {
    const definitions = await ctx.db
      .query("eventDefinitions")
      .withIndex("by_last_seen", (q) => q.gt("lastSeenAt", from - DEFINITION_RESOLUTION_MS))
      .collect();
    return definitions.flatMap((definition) => (definition.firstSeenAt < to ? [definition.name] : []));
  },
});

/** Sessions that started in the range, oldest first. */
export const sessions = query({
  args: rangeArgs,
  returns: page(scanSession),
  handler: async (ctx, { from, to, cursor, numItems }) => {
    const sessions = () => ctx.db.query("sessions");
    const result = await pageByKey<Doc<"sessions">>({
      cursor,
      numItems,
      key: (session) => session.startedAt,
      sameKey: (at) =>
        sessions().withIndex("by_started", (q) => q.eq("startedAt", at.key).gt("_creationTime", at.created)),
      rest: (at) =>
        sessions().withIndex("by_started", (q) =>
          at ? q.gt("startedAt", at.key).lt("startedAt", to) : q.gte("startedAt", from).lt("startedAt", to),
        ),
    });
    return {
      page: result.page.map((session) => ({
        sessionId: session.sessionId,
        personId: session.personId,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        pageviews: session.pageviews,
        interactions: session.interactions,
        entryPath: session.entryPath,
        exitPath: session.exitPath,
        source: session.source,
        device: session.device,
        country: session.country,
      })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** Everyone, a page at a time: what counting them reads. */
export const persons = query({
  args: pageArgs,
  returns: page(scanPerson),
  handler: async (ctx, { cursor, numItems }) => {
    const persons = () => ctx.db.query("persons");
    const result = await pageByKey<Doc<"persons">>({
      cursor,
      numItems,
      key: (person) => person.lastSeenAt,
      sameKey: (at) =>
        persons().withIndex("by_last_seen", (q) => q.eq("lastSeenAt", at.key).gt("_creationTime", at.created)),
      rest: (at) => persons().withIndex("by_last_seen", (q) => (at ? q.gt("lastSeenAt", at.key) : q)),
    });
    return {
      page: result.page.map(({ identified, createdAt, lastSeenAt }) => ({ identified, createdAt, lastSeenAt })),
      isDone: result.isDone,
      continueCursor: result.continueCursor,
    };
  },
});

/** When each of these people was first seen; people that no longer exist are left out. */
export const firstSeen = query({
  args: { personIds: v.array(v.string()) },
  returns: v.array(v.object({ personId: v.id("persons"), createdAt: v.number() })),
  handler: async (ctx, { personIds }) => {
    const found: { personId: Id<"persons">; createdAt: number }[] = [];
    for (const raw of personIds.slice(0, 500)) {
      const personId = ctx.db.normalizeId("persons", raw);
      const person = personId ? await ctx.db.get(personId) : null;
      if (person) found.push({ personId: person._id, createdAt: person.createdAt });
    }
    return found;
  },
});

/** Where each of these sessions came from; sessions that no longer exist are left out. */
export const sessionSources = query({
  args: { sessionIds: v.array(v.string()) },
  returns: v.array(
    v.object({ sessionId: v.string(), source: sourceValidator, country: v.union(v.string(), v.null()) }),
  ),
  handler: async (ctx, { sessionIds }) => {
    const found = [];
    for (const sessionId of sessionIds.slice(0, 500)) {
      const session = await ctx.db
        .query("sessions")
        .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
        .unique();
      if (session) found.push({ sessionId, source: session.source, country: session.country });
    }
    return found;
  },
});
