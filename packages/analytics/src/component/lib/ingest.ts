import type { Infer } from "convex/values";
import { EVENTS, type WireEvent } from "../../shared/events";
import { numberProperty, type Properties, stringProperty } from "../../shared/properties";
import { trafficSource } from "../../shared/source";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { deviceValidator, requestContextValidator } from "../validators";
import { INGEST_LIMITS, take } from "./limits";
import { markChanged } from "./rollupDays";

export type RequestContext = Infer<typeof requestContextValidator>;
type DeviceInfo = Infer<typeof deviceValidator>;

const UNKNOWN_DEVICE: DeviceInfo = { browser: null, browserVersion: null, os: null, osVersion: null, deviceType: null };

/** Seeing someone again within this long doesn't rewrite their row: it keeps writes (and conflicts) down. */
const LAST_SEEN_RESOLUTION_MS = 60_000;

/** How stale an event name's last-seen time may get before it's written again. */
export const DEFINITION_RESOLUTION_MS = 3_600_000;

/** Events that count as someone doing something on the page, not just looking. */
const INTERACTIONS = new Set<string>([EVENTS.autocapture, EVENTS.rageclick]);

interface PersonDraft {
  doc: Doc<"persons">;
  dirty: boolean;
}

interface SessionDraft {
  doc: Doc<"sessions">;
  dirty: boolean;
  /** When it started before this batch, for a stored session: the day its rollup is on. */
  storedStart: number | null;
}

export interface IngestResult {
  stored: number;
  /** Events already stored: a batch the sender retried. */
  duplicates: number;
}

/**
 * Stores events and keeps people and sessions up to date, in one
 * transaction per batch. People and sessions are read once, changed in
 * memory, and written once at the end, so a batch of fifty events costs
 * fifty inserts and a couple of patches. Events and sessions on days that
 * are over (late batches, sessions running past midnight) mark those days'
 * rollups as changed.
 */
export async function ingestEvents(
  ctx: MutationCtx,
  events: readonly WireEvent[],
  context: RequestContext | null,
  options: { identified?: boolean } = {},
): Promise<IngestResult> {
  const batch = new IngestBatch(ctx, context);
  const moments: number[] = [];
  let stored = 0;
  let duplicates = 0;
  for (const event of [...events].sort((a, b) => a.timestamp - b.timestamp)) {
    const seen = await ctx.db
      .query("events")
      .withIndex("by_uuid", (q) => q.eq("uuid", event.uuid))
      .first();
    if (seen) {
      duplicates += 1;
      continue;
    }
    if (event.name === EVENTS.identify) await batch.identify(event);
    const person = await batch.person(event.distinctId, event.timestamp);
    if (options.identified && !person.doc.identified) {
      person.doc.identified = true;
      person.dirty = true;
    }
    batch.applyProperties(person, event.set, event.setOnce);
    if (event.sessionId) await batch.session(event, person);
    await ctx.db.insert("events", {
      uuid: event.uuid,
      name: event.name,
      distinctId: event.distinctId,
      personId: person.doc._id,
      sessionId: event.sessionId,
      timestamp: event.timestamp,
      path: event.path,
      properties: event.properties,
      ...(event.group ? { group: event.group } : {}),
    });
    moments.push(event.timestamp);
    stored += 1;
  }
  moments.push(...(await batch.flush()));
  await markChanged(ctx, moments);
  await recordDefinitions(ctx, events);
  return { stored, duplicates };
}

/** Keeps the list of event names current, writing each name at most once an hour. */
async function recordDefinitions(ctx: MutationCtx, events: readonly WireEvent[]): Promise<void> {
  const latest = new Map<string, { first: number; last: number }>();
  for (const event of events) {
    const seen = latest.get(event.name);
    latest.set(event.name, {
      first: Math.min(seen?.first ?? event.timestamp, event.timestamp),
      last: Math.max(seen?.last ?? event.timestamp, event.timestamp),
    });
  }
  for (const [name, { first, last }] of latest) {
    const definition = await ctx.db
      .query("eventDefinitions")
      .withIndex("by_name", (q) => q.eq("name", name))
      .unique();
    if (!definition) {
      await ctx.db.insert("eventDefinitions", { name, firstSeenAt: first, lastSeenAt: last });
    } else if (last - definition.lastSeenAt >= DEFINITION_RESOLUTION_MS || first < definition.firstSeenAt) {
      await ctx.db.patch(definition._id, {
        firstSeenAt: Math.min(first, definition.firstSeenAt),
        lastSeenAt: Math.max(last, definition.lastSeenAt),
      });
    }
  }
}

class IngestBatch {
  private readonly persons = new Map<Id<"persons">, PersonDraft>();
  private readonly owners = new Map<string, Id<"persons">>();
  private readonly sessions = new Map<string, SessionDraft>();

  constructor(
    private readonly ctx: MutationCtx,
    private readonly context: RequestContext | null,
  ) {}

  /** The person a distinct id belongs to, or null when it's new. */
  private async lookup(distinctId: string): Promise<PersonDraft | null> {
    const cached = this.owners.get(distinctId);
    if (cached) return await this.load(cached);
    const row = await this.ctx.db
      .query("distinctIds")
      .withIndex("by_distinct_id", (q) => q.eq("distinctId", distinctId))
      .unique();
    if (!row) return null;
    this.owners.set(distinctId, row.personId);
    return await this.load(row.personId);
  }

  private async load(personId: Id<"persons">): Promise<PersonDraft | null> {
    const cached = this.persons.get(personId);
    if (cached) return cached;
    const doc = await this.ctx.db.get(personId);
    if (!doc) return null;
    const draft = { doc, dirty: false };
    this.persons.set(personId, draft);
    return draft;
  }

  private async create(distinctIds: readonly string[], at: number, identified: boolean): Promise<PersonDraft> {
    const fields = {
      createdAt: at,
      lastSeenAt: at,
      identified,
      properties: {},
      initialSource: null,
      initialPath: null,
    };
    const personId = await this.ctx.db.insert("persons", fields);
    for (const distinctId of distinctIds) await this.link(distinctId, personId);
    const doc = await this.ctx.db.get(personId);
    if (!doc) throw new Error("A person vanished as it was made.");
    const draft = { doc, dirty: false };
    this.persons.set(personId, draft);
    return draft;
  }

  private async link(distinctId: string, personId: Id<"persons">): Promise<void> {
    await this.ctx.db.insert("distinctIds", { distinctId, personId });
    this.owners.set(distinctId, personId);
  }

  /** The person behind `distinctId`, made on first sight, with `at` counted as seen. */
  async person(distinctId: string, at: number): Promise<PersonDraft> {
    const person = (await this.lookup(distinctId)) ?? (await this.create([distinctId], at, false));
    const { doc } = person;
    if (at < doc.createdAt) {
      doc.createdAt = at;
      person.dirty = true;
    }
    if (at - doc.lastSeenAt >= LAST_SEEN_RESOLUTION_MS) {
      doc.lastSeenAt = at;
      person.dirty = true;
    }
    return person;
  }

  applyProperties(person: PersonDraft, set: Properties | null, setOnce: Properties | null): void {
    const current = person.doc.properties;
    for (const [key, value] of Object.entries(setOnce ?? {})) {
      if (key in current) continue;
      current[key] = value;
      person.dirty = true;
    }
    for (const [key, value] of Object.entries(set ?? {})) {
      if (current[key] === value) continue;
      current[key] = value;
      person.dirty = true;
    }
  }

  /**
   * `$identify`: the anonymous id a browser used before signing in now
   * belongs to the account's person. When both already have a person, the
   * anonymous one is merged in, unless it was itself signed in to another
   * account (a shared computer): two accounts are never merged.
   */
  /** Whether the account still takes an `$identify` linking or merge today. */
  private async allowsIdentify(accountId: string): Promise<boolean> {
    return (
      (await take(this.ctx, `identify:merge:${accountId}`, 1, INGEST_LIMITS.mergesPerAccountPerDay, 86_400_000)) > 0
    );
  }

  async identify(event: WireEvent): Promise<void> {
    const accountId = event.distinctId;
    const anonymousId = stringProperty(event.properties, "anonDistinctId");
    const account = await this.lookup(accountId);
    const anonymous = anonymousId && anonymousId !== accountId ? await this.lookup(anonymousId) : null;
    let target: PersonDraft;
    if (!account && !anonymous) {
      const ids = anonymousId && anonymousId !== accountId ? [accountId, anonymousId] : [accountId];
      target = await this.create(ids, event.timestamp, true);
    } else if (!account && anonymous?.doc.identified) {
      // The browser's id is another account's: this account starts a person of its own.
      target = await this.create([accountId], event.timestamp, true);
    } else if (!account && anonymous) {
      await this.link(accountId, anonymous.doc._id);
      target = anonymous;
    } else if (account && !anonymous) {
      // Linking an unseen id into an account is the same gift to a forger as
      // merging one in, so it draws from the same day's allowance.
      if (anonymousId && anonymousId !== accountId && (await this.allowsIdentify(accountId))) {
        await this.link(anonymousId, account.doc._id);
      }
      target = account;
    } else if (account && anonymous && account.doc._id !== anonymous.doc._id && !anonymous.doc.identified) {
      // The route is public and sends no proof of who it speaks for, so an
      // account only takes a few merges a day (`lib/limits.ts`): enough for a
      // person's own browsers, too few to make merging into someone else's
      // person a tool.
      if (await this.allowsIdentify(accountId)) await this.merge(anonymous, account);
      target = account;
    } else {
      // Already one person, or the anonymous one is someone else's account.
      target = account ?? (anonymous as PersonDraft);
    }
    if (!target.doc.identified) {
      target.doc.identified = true;
      target.dirty = true;
    }
  }

  /**
   * Folds `from` into `into`: its distinct ids move now, so new events land
   * on `into`; its stored events and sessions move in the background
   * (`persons.finishMerge`), which then deletes it.
   */
  private async merge(from: PersonDraft, into: PersonDraft): Promise<void> {
    const ids = await this.ctx.db
      .query("distinctIds")
      .withIndex("by_person", (q) => q.eq("personId", from.doc._id))
      .collect();
    for (const row of ids) {
      await this.ctx.db.patch(row._id, { personId: into.doc._id });
      this.owners.set(row.distinctId, into.doc._id);
    }
    const target = into.doc;
    if (from.doc.createdAt < target.createdAt) {
      target.createdAt = from.doc.createdAt;
      target.initialSource = from.doc.initialSource ?? target.initialSource;
      target.initialPath = from.doc.initialPath ?? target.initialPath;
    }
    target.lastSeenAt = Math.max(target.lastSeenAt, from.doc.lastSeenAt);
    target.properties = { ...from.doc.properties, ...target.properties };
    into.dirty = true;
    from.doc.mergedInto = target._id;
    from.dirty = true;
    await this.ctx.scheduler.runAfter(0, internal.persons.finishMerge, { from: from.doc._id, into: target._id });
  }

  /** Counts the event on its session, starting the session on its first event. */
  async session(event: WireEvent, person: PersonDraft): Promise<void> {
    const sessionId = event.sessionId;
    if (!sessionId) return;
    let draft = this.sessions.get(sessionId);
    if (!draft) {
      const doc = await this.ctx.db
        .query("sessions")
        .withIndex("by_session_id", (q) => q.eq("sessionId", sessionId))
        .unique();
      draft = doc ? { doc, dirty: false, storedStart: doc.startedAt } : await this.startSession(event, person);
      this.sessions.set(sessionId, draft);
    }
    const doc = draft.doc;
    doc.events += 1;
    if (event.name === EVENTS.pageview) {
      doc.pageviews += 1;
      if (event.timestamp < doc.startedAt) doc.entryPath = event.path;
      if (event.timestamp >= doc.endedAt) doc.exitPath = event.path;
    }
    if (INTERACTIONS.has(event.name)) doc.interactions += 1;
    doc.startedAt = Math.min(doc.startedAt, event.timestamp);
    doc.endedAt = Math.max(doc.endedAt, event.timestamp);
    // After `$identify`, the rest of the session is the signed-in person's.
    doc.personId = person.doc._id;
    doc.distinctId = event.distinctId;
    draft.dirty = true;
  }

  private async startSession(event: WireEvent, person: PersonDraft): Promise<SessionDraft> {
    const props = event.properties;
    const source = trafficSource({
      referrer: stringProperty(props, "referrer"),
      ownHost: this.context?.ownHost ?? null,
      utmSource: stringProperty(props, "utmSource"),
      utmMedium: stringProperty(props, "utmMedium"),
      utmCampaign: stringProperty(props, "utmCampaign"),
    });
    const fields = {
      sessionId: event.sessionId ?? "",
      personId: person.doc._id,
      distinctId: event.distinctId,
      startedAt: event.timestamp,
      endedAt: event.timestamp,
      events: 0,
      pageviews: 0,
      interactions: 0,
      // Usually a page view's; a session that began with a click on a page left open starts there.
      entryPath: event.path,
      exitPath: event.path,
      source,
      device: this.context?.device ?? UNKNOWN_DEVICE,
      country: stringProperty(props, "country"),
      viewportWidth: numberProperty(props, "viewportWidth"),
    };
    const doc = await this.ctx.db.get(await this.ctx.db.insert("sessions", fields));
    if (!doc) throw new Error("A session vanished as it was made.");
    if (person.doc.initialSource === null) {
      person.doc.initialSource = source;
      person.doc.initialPath = event.path;
      person.dirty = true;
    }
    return { doc, dirty: true, storedStart: null };
  }

  /** Writes what changed; returns when the changed sessions started, before and after. */
  async flush(): Promise<number[]> {
    for (const { doc, dirty } of this.persons.values()) {
      if (!dirty) continue;
      const { _id, _creationTime, ...fields } = doc;
      await this.ctx.db.replace(_id, fields);
    }
    const starts: number[] = [];
    for (const { doc, dirty, storedStart } of this.sessions.values()) {
      if (!dirty) continue;
      const { _id, _creationTime, ...fields } = doc;
      await this.ctx.db.replace(_id, fields);
      starts.push(doc.startedAt);
      if (storedStart !== null) starts.push(storedStart);
    }
    return starts;
  }
}
