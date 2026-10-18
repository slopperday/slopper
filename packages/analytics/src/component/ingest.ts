import { v } from "convex/values";
import { BATCH_LIMITS } from "../shared/events";
import { normalizeProperties } from "../shared/properties";
import { mutation } from "./_generated/server";
import { ingestEvents } from "./lib/ingest";
import { properties, requestContextValidator, wireEventValidator } from "./validators";

const resultValidator = v.object({ stored: v.number(), duplicates: v.number() });

/**
 * A batch from the SDK, already validated by `parseBatch` (shared/events.ts)
 * in the HTTP endpoint, with what the endpoint learned from the request.
 */
export const batch = mutation({
  args: { events: v.array(wireEventValidator), context: requestContextValidator },
  returns: resultValidator,
  handler: async (ctx, { events, context }) => {
    return await ingestEvents(ctx, events.slice(0, BATCH_LIMITS.events), context);
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
    return await ingestEvents(ctx, [event], null, { identified: args.identified });
  },
});
