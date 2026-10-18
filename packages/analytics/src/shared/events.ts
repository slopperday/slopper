import { normalizeProperties, type Properties } from "./properties";

/**
 * The events the SDK sends on its own. Their names start with `$` so they
 * never collide with an app's own events ("slop launched").
 */
export const EVENTS = {
  /** A page was shown. Carries where the visit came from on the first one of a session. */
  pageview: "$pageview",
  /** A page was left: how long it was open and how far down it was read. */
  pageleave: "$pageleave",
  /** A click, form submission or field change, captured without any code. */
  autocapture: "$autocapture",
  /** Three or more clicks in one spot within a second: someone is frustrated. */
  rageclick: "$rageclick",
  /** An anonymous visitor signed in: links their earlier events to their account. */
  identify: "$identify",
  /** An uncaught error, a rejected promise, or one an app reported. */
  exception: "$exception",
  /** Core Web Vitals for one page view. */
  webVitals: "$webVitals",
  /** Code read a feature flag: who saw which variant, for experiments. */
  flagCalled: "$featureFlagCalled",
  surveyShown: "$surveyShown",
  surveySent: "$surveySent",
  surveyDismissed: "$surveyDismissed",
} as const;

/** One event as the SDK sends it. */
export interface WireEvent {
  /** Made by the sender (a UUIDv7), so a batch sent twice is stored once. */
  uuid: string;
  name: string;
  /** Who did it: an anonymous id until they sign in, then their account's id. */
  distinctId: string;
  /** The browser session; null for events an app server captured. */
  sessionId: string | null;
  /** When it happened, by the sender's clock. */
  timestamp: number;
  /** The page's path, without its query string. */
  path: string | null;
  properties: Properties;
  /** Person properties to set, overwriting earlier values. */
  set: Properties | null;
  /** Person properties to set only if they have no value yet. */
  setOnce: Properties | null;
}

export interface WireBatch {
  /** The sender's clock when the batch left, to correct a skewed clock. */
  sentAt: number;
  events: WireEvent[];
}

export const BATCH_LIMITS = {
  events: 100,
  /** Bytes of JSON one batch may take. */
  bytes: 512 * 1024,
  nameLength: 200,
  idLength: 200,
  pathLength: 1_000,
  /** Older events are dropped: a browser that was offline for a week sends history, not activity. */
  maxAgeMs: 7 * 86_400_000,
} as const;

/** A batch after validation: what the component stores. */
export interface ParsedBatch {
  events: WireEvent[];
  /** Events that weren't valid, or were too old. */
  dropped: number;
}

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max ? trimmed : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function optionalProperties(value: unknown): Properties | null {
  if (value === null || value === undefined) return null;
  const properties = normalizeProperties(value);
  return Object.keys(properties).length > 0 ? properties : null;
}

/**
 * Validates a batch from a browser (or anything else that can reach the
 * endpoint: it's public). Invalid events are dropped one by one rather than
 * failing the batch, and timestamps are moved by the gap between the
 * sender's clock and `receivedAt`, the way PostHog corrects skewed clocks.
 */
export function parseBatch(input: unknown, receivedAt: number): ParsedBatch {
  if (typeof input !== "object" || input === null || !("events" in input) || !Array.isArray(input.events)) {
    return { events: [], dropped: 0 };
  }
  const sentAt = "sentAt" in input ? finite(input.sentAt) : null;
  const skew = sentAt === null ? 0 : receivedAt - sentAt;
  const events: WireEvent[] = [];
  let dropped = Math.max(0, input.events.length - BATCH_LIMITS.events);
  for (const raw of input.events.slice(0, BATCH_LIMITS.events)) {
    const event = parseEvent(raw, skew, receivedAt);
    if (event) events.push(event);
    else dropped += 1;
  }
  return { events, dropped };
}

function parseEvent(raw: unknown, skew: number, receivedAt: number): WireEvent | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const uuid = text(record.uuid, 64);
  const name = text(record.name, BATCH_LIMITS.nameLength);
  const distinctId = text(record.distinctId, BATCH_LIMITS.idLength);
  const sent = finite(record.timestamp);
  if (!uuid || !name || !distinctId || sent === null) return null;
  // Nothing happens in the future: a clock still ahead after correcting means now.
  const timestamp = Math.min(Math.round(sent + skew), receivedAt);
  if (timestamp < receivedAt - BATCH_LIMITS.maxAgeMs) return null;
  return {
    uuid,
    name,
    distinctId,
    sessionId: text(record.sessionId, BATCH_LIMITS.idLength),
    timestamp,
    path: text(record.path, BATCH_LIMITS.pathLength),
    properties: normalizeProperties(record.properties),
    set: optionalProperties(record.set),
    setOnce: optionalProperties(record.setOnce),
  };
}
