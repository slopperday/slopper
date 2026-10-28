import { v } from "convex/values";
import { BATCH_LIMITS, isBrowserEvent } from "../shared/events";
import { normalizeProperties } from "../shared/properties";
import { internalMutation, mutation } from "./_generated/server";
import { ingestEvents } from "./lib/ingest";
import { INGEST_LIMITS, take } from "./lib/limits";
import { properties, requestContextValidator, wireEventValidator } from "./validators";

const resultValidator = v.object({ stored: v.number(), duplicates: v.number(), throttled: v.number() });

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * Admission before the HTTP route reads a body or resolves paths. Rejected
 * payloads spend attempts too; later event and storage caps still apply.
 */
export const admit = mutation({
  args: { kind: v.union(v.literal("events"), v.literal("replay")) },
  returns: v.boolean(),
  handler: async (ctx, { kind }) => {
    if ((await take(ctx, "requests:minute", 1, INGEST_LIMITS.requestsPerMinute, MINUTE_MS)) === 0) return false;
    if ((await take(ctx, "requests:day", 1, INGEST_LIMITS.requestsPerDay, DAY_MS)) === 0) return false;

    // Convex supplies the address; client-controlled forwarding headers and
    // distinct ids cannot evade it. Persist only a digest, rotated daily.
    const { ip } = await ctx.meta.getRequestMetadata();
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${Math.floor(Date.now() / DAY_MS)}:${ip ?? "unknown"}`),
    );
    const address = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");

    if (
      (await take(ctx, `requests:address:${address}`, 1, INGEST_LIMITS.requestsPerAddressPerMinute, MINUTE_MS)) === 0
    ) {
      return false;
    }

    // Once accepted-volume caps are full, stop before parsing or starting a
    // storage action. These reads reserve nothing; the later caps stay atomic.
    const ceilings =
      kind === "events"
        ? ([
            ["events:minute", INGEST_LIMITS.eventsPerMinute, MINUTE_MS],
            ["events:day", INGEST_LIMITS.eventsPerDay, DAY_MS],
          ] as const)
        : ([
            ["replay:chunks:minute", INGEST_LIMITS.replayChunksPerMinute, MINUTE_MS],
            ["replay:bytes:day", INGEST_LIMITS.replayBytesPerDay, DAY_MS],
          ] as const);

    for (const [key, cap, windowMs] of ceilings) {
      const row = await ctx.db
        .query("counters")
        .withIndex("by_key_window", (q) => q.eq("key", key).eq("window", Math.floor(Date.now() / windowMs)))
        .unique();

      if ((row?.count ?? 0) >= cap) return false;
    }

    return true;
  },
});

/**
 * A batch from the SDK, already validated by `parseBatch` (shared/events.ts)
 * in the HTTP endpoint, with what the endpoint learned from the request.
 * The route is public, so the batch is trimmed to what the deployment's
 * ingest ceilings (`lib/limits.ts`) still allow.
 */
export const batch = mutation({
  args: { events: v.array(wireEventValidator), context: requestContextValidator, accountId: v.optional(v.string()) },
  returns: resultValidator,
  handler: async (ctx, { events, context, accountId }) => {
    const valid = events.slice(0, BATCH_LIMITS.events).filter((event) => isBrowserEvent(event.name));
    const minute = await take(ctx, "events:minute", valid.length, INGEST_LIMITS.eventsPerMinute, MINUTE_MS);
    const day = await take(ctx, "events:day", minute, INGEST_LIMITS.eventsPerDay, DAY_MS);
    let kept = valid.slice(0, day);
    // One distinct id can't spend the whole day's ceiling on its own.
    const counts = new Map<string, number>();
    for (const event of kept) counts.set(event.distinctId, (counts.get(event.distinctId) ?? 0) + 1);
    for (const [distinctId, want] of counts) {
      const allowed = await take(ctx, `events:id:${distinctId}`, want, INGEST_LIMITS.eventsPerDistinctIdPerDay, DAY_MS);
      if (allowed === want) continue;
      let left = allowed;
      kept = kept.filter((event) => event.distinctId !== distinctId || left-- > 0);
    }
    const result = await ingestEvents(ctx, kept, context, { browser: true, accountId });
    return { ...result, throttled: valid.length - result.stored - result.duplicates };
  },
});

/**
 * One event from the app's own server code, like "signed up" from the
 * mutation that made the account: it can't be blocked or lost the way a
 * browser's can. It belongs to no browser session.
 */
export const capture = mutation({
  args: {
    name: v.string(),
    distinctId: v.string(),
    properties: v.optional(properties),
    set: v.optional(properties),
    setOnce: v.optional(properties),
    timestamp: v.optional(v.number()),
    /** The distinct id is an account's, so its person counts as signed in. */
    identified: v.optional(v.boolean()),
    /** What it's about, `type:id`, like the slop that was voted on. */
    group: v.optional(v.string()),
    /** The page it happened on, when there was one (a server error while rendering it). */
    path: v.optional(v.string()),
  },
  returns: resultValidator,
  handler: async (ctx, args) => {
    const set = args.set ? normalizeProperties(args.set) : null;
    const setOnce = args.setOnce ? normalizeProperties(args.setOnce) : null;
    const event = {
      uuid: crypto.randomUUID(),
      name: args.name.slice(0, BATCH_LIMITS.nameLength),
      distinctId: args.distinctId.slice(0, BATCH_LIMITS.idLength),
      sessionId: null,
      timestamp: args.timestamp ?? Date.now(),
      path: args.path?.slice(0, BATCH_LIMITS.pathLength) ?? null,
      properties: normalizeProperties(args.properties ?? {}),
      set: set && Object.keys(set).length > 0 ? set : null,
      setOnce: setOnce && Object.keys(setOnce).length > 0 ? setOnce : null,
      group: args.group?.slice(0, BATCH_LIMITS.idLength) ?? null,
    };
    // Server captures are trusted, so no ceiling applies — but the shape matches a batch's.
    return { ...(await ingestEvents(ctx, [event], null, { identified: args.identified })), throttled: 0 };
  },
});

/** Spends from an ingest ceiling for an action (the recordings route); mutations call `take` directly. */
export const spend = internalMutation({
  args: { key: v.string(), amount: v.number(), cap: v.number(), windowMs: v.number() },
  returns: v.number(),
  handler: async (ctx, { key, amount, cap, windowMs }) => await take(ctx, key, amount, cap, windowMs),
});
