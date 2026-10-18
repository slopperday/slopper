import {
  Analytics,
  type ExperimentAnswer,
  flagConditionValidator,
  type FlagDefinition,
  flagVariantValidator,
  type InsightAnswer,
  insightQueryValidator,
  type Overview,
  propertyFilterValidator,
} from "@slopperday/analytics/convex";
import { bucketsIn, type GroupReport, type GroupRow, type GroupsResult } from "@slopperday/analytics/shared/insights";
import { ConvexError, v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { components, internal } from "./_generated/api";
import {
  action,
  type ActionCtx,
  internalMutation,
  internalQuery,
  mutation,
  type MutationCtx,
  query,
  type QueryCtx,
} from "./_generated/server";
import { readerFor, requireServer } from "./lib/auth";
import { can, requirePermission } from "./lib/permissions";
import { logStaffAction } from "./lib/staffLog";
import { normalizeUsername } from "../app/lib/username";

/**
 * Slopper's first-party analytics (packages/analytics): events, people and
 * sessions live in this deployment, in the analytics component's own
 * tables, and nothing is sent anywhere else. Only admins read it
 * (`analytics.view`), through the functions below.
 */
export const analytics = new Analytics(components.analytics);

/** Raw events and sessions are kept a year; people not seen for a year go with them. */
export const RETENTION = { eventDays: 365, personDays: 365 } as const;

/** Sessions with activity this recently count as people here now. */
const LIVE_WINDOW_MS = 5 * 60_000;

/**
 * The analytics group for a slop: its page's events (convex/http.ts) and
 * the votes, pledges, updates and comments on it all carry it, so each
 * slop has analytics of its own (`slopReport`).
 */
export function slopGroup(slopId: Id<"slops">): string {
  return `slop:${slopId}`;
}

/**
 * What people do that matters most, captured where it happens rather than
 * in the browser, so blockers and closed tabs can't lose it. Signed-in
 * people's distinct id is their user id, which the browser identifies them
 * with too (app/root.tsx). Events about a slop name it.
 */
export type ProductEvent =
  | { name: "signed up"; properties: { provider: string } }
  | {
      name: "slop launched";
      slopId: Id<"slops">;
      properties: { category: string; relaunch: boolean; goalDay: number | null };
    }
  // Downvotes are private: never shown to makers (`MAKER_ACTIONS`), here or anywhere.
  | { name: "upvoted" | "downvoted" | "unvoted"; slopId: Id<"slops"> }
  | { name: "pledged"; slopId: Id<"slops"> }
  | { name: "update posted"; slopId: Id<"slops">; properties: { kind: string } }
  | { name: "commented"; slopId: Id<"slops">; properties: { kind: "feedback" | "kudos" } }
  | { name: "goal set"; properties: { days: number; target: number } };

export async function captureFor(ctx: MutationCtx, userId: Id<"users">, event: ProductEvent): Promise<void> {
  await analytics.capture(ctx, {
    name: event.name,
    distinctId: userId,
    properties: "properties" in event ? event.properties : {},
    identified: true,
    ...("slopId" in event ? { group: slopGroup(event.slopId) } : {}),
  });
}

/** Deletes what's past `RETENTION`, daily (convex/crons.ts). */
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    await analytics.sweep(ctx, RETENTION);
  },
});

const analyticsPermission = v.union(v.literal("analytics.view"), v.literal("analytics.manage"));

/** An admin's stored role, checked for actions, which can't read the database themselves. */
export const checkPermission = internalQuery({
  args: { userId: v.id("users"), permission: analyticsPermission },
  handler: async (ctx, { userId, permission }) => {
    await requirePermission(ctx, userId, permission);
    return null;
  },
});

async function requireAnalyticsAction(ctx: ActionCtx, adminId: Id<"users">): Promise<void> {
  await requireServer(ctx);
  await ctx.runQuery(internal.analytics.checkPermission, { userId: adminId, permission: "analytics.view" });
}

async function requireAnalytics(ctx: QueryCtx, adminId: Id<"users">): Promise<void> {
  await requireServer(ctx);
  await requirePermission(ctx, adminId, "analytics.view");
}

/** The username behind any of a person's distinct ids: signed-in people's ids are user ids. */
async function usernameOf(ctx: QueryCtx, distinctIds: readonly string[]): Promise<string | null> {
  for (const distinctId of distinctIds) {
    const userId = ctx.db.normalizeId("users", distinctId);
    const user = userId ? await ctx.db.get(userId) : null;
    if (user) return user.username;
  }
  return null;
}

/** An insight: trends, funnels, retention, paths, stickiness, lifecycle or web analytics. */
export const insight = action({
  args: { adminId: v.id("users"), query: insightQueryValidator },
  handler: async (ctx, { adminId, query }): Promise<InsightAnswer> => {
    await requireAnalyticsAction(ctx, adminId);
    return await analytics.insight(ctx, query);
  },
});

export const accountsPage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const result = await ctx.db.query("users").paginate({ cursor, numItems: 4_000 });
    return { count: result.page.length, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** How many people there are: visitors, signed in, active lately, and Slopper accounts. */
export const overview = action({
  args: { adminId: v.id("users") },
  handler: async (ctx, { adminId }): Promise<Overview & { accounts: number }> => {
    await requireAnalyticsAction(ctx, adminId);
    let accounts = 0;
    let cursor: string | null = null;
    for (;;) {
      const page: { count: number; isDone: boolean; continueCursor: string } = await ctx.runQuery(
        internal.analytics.accountsPage,
        { cursor },
      );
      accounts += page.count;
      if (page.isDone) break;
      cursor = page.continueCursor;
    }
    return { ...(await analytics.overview(ctx)), accounts };
  },
});

/**
 * Who's here now and what just happened, for the live part of /mod/analytics.
 * Browsers subscribe as the admin; the server reads as them with `asUser`.
 */
export const live = query({
  args: { asUser: v.optional(v.id("users")) },
  handler: async (ctx, { asUser }) => {
    const reader = await readerFor(ctx, asUser);
    if (!can(reader, "analytics.view")) return null;
    const sessions = await ctx.runQuery(components.analytics.sessions.active, {
      since: Date.now() - LIVE_WINDOW_MS,
      limit: 200,
    });
    const events = await ctx.runQuery(components.analytics.events.recent, { limit: 25 });
    const pages = new Map<string, number>();
    for (const session of sessions) {
      if (session.exitPath) pages.set(session.exitPath, (pages.get(session.exitPath) ?? 0) + 1);
    }
    return {
      here: new Set(sessions.map((session) => session.personId)).size,
      pages: [...pages.entries()]
        .map(([path, people]) => ({ path, people }))
        .sort((a, b) => b.people - a.people)
        .slice(0, 8),
      events: events.map((event) => ({
        id: event._id,
        name: event.name,
        path: event.path,
        distinctId: event.distinctId,
        timestamp: event.timestamp,
      })),
    };
  },
});

/** Everyone analytics knows, most recently seen first, with their username when they have an account. */
export const people = query({
  args: { adminId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { adminId, cursor }) => {
    await requireAnalytics(ctx, adminId);
    const result = await ctx.runQuery(components.analytics.persons.list, { cursor, numItems: 50 });
    const page = [];
    for (const person of result.page) page.push({ ...person, username: await usernameOf(ctx, person.distinctIds) });
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** A distinct id to look up: a username (with or without @) when one matches, else the text as typed. */
export const findPerson = query({
  args: { adminId: v.id("users"), search: v.string() },
  handler: async (ctx, { adminId, search }): Promise<string | null> => {
    await requireAnalytics(ctx, adminId);
    const typed = search.trim();
    if (!typed) return null;
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalizeUsername(typed.replace(/^@/, ""))))
      .unique();
    if (user) return user._id;
    const person = await ctx.runQuery(components.analytics.persons.get, { distinctId: typed });
    return person ? typed : null;
  },
});

/** One person: who they are, their sessions and their latest events. */
export const person = query({
  args: { adminId: v.id("users"), distinctId: v.string() },
  handler: async (ctx, { adminId, distinctId }) => {
    await requireAnalytics(ctx, adminId);
    const person = await ctx.runQuery(components.analytics.persons.get, { distinctId });
    if (!person) return null;
    const [sessions, events] = await Promise.all([
      ctx.runQuery(components.analytics.sessions.forPerson, { distinctId, limit: 30 }),
      ctx.runQuery(components.analytics.events.recent, { distinctId, limit: 100 }),
    ]);
    const recorded = await ctx.runQuery(components.analytics.recordings.recorded, {
      sessionIds: sessions.map((session) => session.sessionId),
    });
    return { person, username: await usernameOf(ctx, person.distinctIds), sessions, events, recorded };
  },
});

/** One session, everything that happened in it, and its recording (with where to fetch it) when there is one. */
export const session = query({
  args: { adminId: v.id("users"), sessionId: v.string() },
  handler: async (ctx, { adminId, sessionId }) => {
    await requireAnalytics(ctx, adminId);
    const found = await ctx.runQuery(components.analytics.sessions.get, { sessionId });
    if (!found) return null;
    const [person, recording] = await Promise.all([
      ctx.runQuery(components.analytics.persons.get, { distinctId: found.session.distinctId }),
      ctx.runQuery(components.analytics.recordings.get, { sessionId }),
    ]);
    return { ...found, recording, username: person ? await usernameOf(ctx, person.distinctIds) : null };
  },
});

/** Session recordings, newest first, with who they were. */
export const recordings = query({
  args: { adminId: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { adminId, cursor }) => {
    await requireAnalytics(ctx, adminId);
    const result = await ctx.runQuery(components.analytics.recordings.list, { cursor, numItems: 50 });
    const page = [];
    for (const { recording, session } of result.page) {
      const person = await ctx.runQuery(components.analytics.persons.get, { distinctId: recording.distinctId });
      page.push({ recording, session, username: person ? await usernameOf(ctx, person.distinctIds) : null });
    }
    return { page, isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/** Every event name seen lately, for the insight pickers. */
export const eventNames = query({
  args: { adminId: v.id("users") },
  handler: async (ctx, { adminId }): Promise<string[]> => {
    await requireAnalytics(ctx, adminId);
    const definitions = await ctx.runQuery(components.analytics.definitions.list, {});
    return definitions.map((definition) => definition.name);
  },
});

/** Deletes everything analytics has on a person, and logs who asked. */
export const forget = mutation({
  args: { adminId: v.id("users"), distinctId: v.string() },
  handler: async (ctx, { adminId, distinctId }): Promise<boolean> => {
    await requireServer(ctx);
    await requirePermission(ctx, adminId, "analytics.manage");
    const person = await ctx.runQuery(components.analytics.persons.get, { distinctId });
    if (!person) return false;
    const username = await usernameOf(ctx, person.distinctIds);
    await analytics.forget(ctx, distinctId);
    await logStaffAction(ctx, adminId, { type: "forgetPerson" }, username ? `@${username}` : `visitor ${distinctId}`);
    return true;
  },
});

const SLOP_PAGE = /^\/@([^/]+)\/([^/]+)$/;

/**
 * Which slop each path is the page of (`/@username/slug`), as its analytics
 * group, so every view and click there counts for that slop. Other paths,
 * and slops that don't exist, are left out.
 */
export const slopGroupsForPaths = internalQuery({
  args: { paths: v.array(v.string()) },
  handler: async (ctx, { paths }): Promise<{ path: string; group: string }[]> => {
    const found: { path: string; group: string }[] = [];
    for (const path of paths.slice(0, 100)) {
      const match = SLOP_PAGE.exec(path);
      if (!match) continue;
      const user = await ctx.db
        .query("users")
        .withIndex("by_username", (q) => q.eq("username", decodeURIComponent(match[1] ?? "").toLowerCase()))
        .unique();
      if (!user) continue;
      const slop = await ctx.db
        .query("slops")
        .withIndex("by_user_slug", (q) => q.eq("userId", user._id).eq("slug", decodeURIComponent(match[2] ?? "")))
        .unique();
      if (slop) found.push({ path, group: slopGroup(slop._id) });
    }
    return found;
  },
});

const DAY_MS = 86_400_000;

/** Up to a year back, whole days, up to and including now (a range's end is exclusive). */
function rangeOf(days: number, now: number): { from: number; to: number } {
  const whole = Math.min(365, Math.max(1, Math.round(days)));
  return { from: now - whole * DAY_MS, to: now + 1 };
}

const creationTable = v.union(v.literal("users"), v.literal("slops"), v.literal("updates"));

/** Rows made since `from`, a page at a time: when, by whom, and for updates whether it was a launch note. */
export const createdSince = internalQuery({
  args: { table: creationTable, from: v.number(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { table, from, cursor }) => {
    const page = { cursor, numItems: 4_000 };
    let items: { at: number; userId: Id<"users">; launch: boolean; slopcessful: boolean }[];
    let isDone: boolean;
    let continueCursor: string;
    if (table === "users") {
      const result = await ctx.db
        .query("users")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", from))
        .paginate(page);
      items = result.page.map((user) => ({
        at: user._creationTime,
        userId: user._id,
        launch: false,
        slopcessful: false,
      }));
      ({ isDone, continueCursor } = result);
    } else if (table === "slops") {
      const result = await ctx.db
        .query("slops")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", from))
        .paginate(page);
      items = result.page.map((slop) => ({
        at: slop._creationTime,
        userId: slop.userId,
        launch: true,
        slopcessful: slop.slopcessfulAt !== null,
      }));
      ({ isDone, continueCursor } = result);
    } else {
      const result = await ctx.db
        .query("updates")
        .withIndex("by_creation_time", (q) => q.gte("_creationTime", from))
        .paginate(page);
      items = result.page.map((update) => ({
        at: update._creationTime,
        userId: update.userId,
        launch: update.kind === "launch",
        slopcessful: false,
      }));
      ({ isDone, continueCursor } = result);
    }
    return { items, isDone, continueCursor };
  },
});

async function eachCreated(
  ctx: ActionCtx,
  table: "users" | "slops" | "updates",
  from: number,
  each: (item: { at: number; userId: Id<"users">; launch: boolean; slopcessful: boolean }) => void,
): Promise<void> {
  let cursor: string | null = null;
  for (;;) {
    const page: {
      items: { at: number; userId: Id<"users">; launch: boolean; slopcessful: boolean }[];
      isDone: boolean;
      continueCursor: string;
    } = await ctx.runQuery(internal.analytics.createdSince, { table, from, cursor });
    for (const item of page.items) each(item);
    if (page.isDone) return;
    cursor = page.continueCursor;
  }
}

export interface Growth {
  interval: "day" | "week";
  buckets: number[];
  /** New accounts per period. */
  signups: number[];
  /** Accounts in all at the end of each period. */
  accountsAt: number[];
  launches: number[];
  /** Updates other than launch notes. */
  updates: number[];
  totals: { accounts: number; slops: number; slopcessful: number; makers: number };
}

/**
 * Slopper's growth: accounts (new, and in all at the end of each period),
 * launches, updates and makers, per period over `days`.
 */
export const growth = action({
  args: { adminId: v.id("users"), days: v.number() },
  handler: async (ctx, { adminId, days }): Promise<Growth> => {
    await requireAnalyticsAction(ctx, adminId);
    const now = Date.now();
    const range = rangeOf(days, now);
    const interval: "day" | "week" = range.to - range.from <= 31 * DAY_MS ? "day" : "week";
    const buckets = bucketsIn(range, interval);
    const position = (at: number) => buckets.findLastIndex((start) => start <= at);
    const zeros = () => buckets.map(() => 0);
    const signups = zeros();
    const launches = zeros();
    const updates = zeros();
    const makers = new Set<string>();
    let accounts = 0;
    let slops = 0;
    let slopcessful = 0;
    await eachCreated(ctx, "users", 0, (user) => {
      accounts += 1;
      if (user.at >= range.from) signups[position(user.at)] = (signups[position(user.at)] ?? 0) + 1;
    });
    await eachCreated(ctx, "slops", 0, (slop) => {
      slops += 1;
      if (slop.slopcessful) slopcessful += 1;
      if (slop.at < range.from) return;
      launches[position(slop.at)] = (launches[position(slop.at)] ?? 0) + 1;
      makers.add(slop.userId);
    });
    await eachCreated(ctx, "updates", range.from, (update) => {
      if (!update.launch) updates[position(update.at)] = (updates[position(update.at)] ?? 0) + 1;
    });
    // Accounts in all at the end of each period: today's count, less those made after it.
    let later = 0;
    const accountsAt = zeros();
    for (let index = buckets.length - 1; index >= 0; index -= 1) {
      accountsAt[index] = accounts - later;
      later += signups[index] ?? 0;
    }
    return {
      interval,
      buckets,
      signups,
      accountsAt,
      launches,
      updates,
      totals: { accounts, slops, slopcessful, makers: makers.size },
    };
  },
});

/** What the admin pages show about a slop in a list. */
export interface ListedSlop {
  group: string;
  id: Id<"slops">;
  name: string;
  username: string;
  slug: string;
  upvotes: number;
  slopcessful: boolean;
}

export const slopsForGroups = internalQuery({
  args: { groups: v.array(v.string()) },
  handler: async (ctx, { groups }): Promise<ListedSlop[]> => {
    const found: ListedSlop[] = [];
    for (const group of groups.slice(0, 100)) {
      const slopId = group.startsWith("slop:") ? ctx.db.normalizeId("slops", group.slice("slop:".length)) : null;
      const slop = slopId ? await ctx.db.get(slopId) : null;
      const owner = slop ? await ctx.db.get(slop.userId) : null;
      if (!slop || !owner) continue;
      found.push({
        group,
        id: slop._id,
        name: slop.name,
        username: owner.username,
        slug: slop.slug,
        upvotes: slop.upvotes,
        slopcessful: slop.slopcessfulAt !== null,
      });
    }
    return found;
  },
});

export interface Projects extends Omit<GroupsResult, "rows" | "kind"> {
  truncated: boolean;
  rows: (GroupRow & { slop: ListedSlop })[];
}

/**
 * Which slops are doing better: every slop's page views over `days` against
 * the days before, with the busiest listed by name.
 */
export const projects = action({
  args: { adminId: v.id("users"), days: v.number() },
  handler: async (ctx, { adminId, days }): Promise<Projects> => {
    await requireAnalyticsAction(ctx, adminId);
    const range = rangeOf(days, Date.now());
    const answer = await analytics.insight(ctx, { kind: "groups", range, event: "$pageview", prefix: "slop:" });
    if (answer.result.kind !== "groups") throw new Error("The projects insight answered with another kind.");
    const { rows, kind: _kind, ...summary } = answer.result;
    const slops: ListedSlop[] = await ctx.runQuery(internal.analytics.slopsForGroups, {
      groups: rows.map((row) => row.group),
    });
    const byGroup = new Map(slops.map((slop) => [slop.group, slop]));
    return {
      ...summary,
      truncated: answer.truncated,
      rows: rows.flatMap((row) => {
        const slop = byGroup.get(row.group);
        return slop ? [{ ...row, slop }] : [];
      }),
    };
  },
});

/** The slop a report is about, and the counters Slopper keeps on it. */
export interface ReportedSlop {
  id: Id<"slops">;
  ownerId: Id<"users">;
  username: string;
  slug: string;
  name: string;
  upvotes: number;
  backers: number;
  /** USD cents. */
  pledged: number;
  comments: number;
  updates: number;
  fieldTests: number;
}

/** The slop a report is about, if the person asking may see it: its maker, or an admin. */
export const slopForReport = internalQuery({
  args: { userId: v.id("users"), slopId: v.string() },
  handler: async (ctx, { userId, slopId }): Promise<ReportedSlop | null> => {
    const id = ctx.db.normalizeId("slops", slopId);
    const slop = id ? await ctx.db.get(id) : null;
    const reader = await ctx.db.get(userId);
    if (!slop || !reader || (slop.userId !== userId && !can(reader, "analytics.view"))) return null;
    const owner = await ctx.db.get(slop.userId);
    if (!owner) return null;
    return {
      id: slop._id,
      ownerId: slop.userId,
      username: owner.username,
      slug: slop.slug,
      name: slop.name,
      upvotes: slop.upvotes,
      backers: slop.backers,
      pledged: slop.pledged,
      comments: slop.commentCount,
      updates: slop.updateCount,
      fieldTests: slop.fieldTests,
    };
  },
});

/**
 * A slop's own analytics, for its maker (and admins): views, the people
 * behind them, where they came from, what they clicked, and votes, pledges
 * and comments, over `days` against the days before. The maker's own
 * visits don't count.
 */
/** What a maker's report shows of what people did: never downvotes, which are private. */
export const MAKER_ACTIONS: ReadonlySet<string> = new Set(["upvoted", "pledged", "commented", "update posted"]);

export interface SlopReport {
  slop: ReportedSlop;
  report: GroupReport;
  truncated: boolean;
  days: number;
}

export const slopReport = action({
  args: { userId: v.id("users"), slopId: v.string(), days: v.number() },
  handler: async (ctx, { userId, slopId, days }): Promise<SlopReport> => {
    await requireServer(ctx);
    const slop: ReportedSlop | null = await ctx.runQuery(internal.analytics.slopForReport, { userId, slopId });
    if (!slop) throw new ConvexError("That slop isn't yours.");
    const maker = await ctx.runQuery(components.analytics.persons.get, { distinctId: slop.ownerId });
    const range = rangeOf(days, Date.now());
    const { report, truncated } = await analytics.groupReport(ctx, {
      group: slopGroup(slop.id),
      range,
      interval: range.to - range.from <= 31 * DAY_MS ? "day" : "week",
      excludePersonIds: maker ? [maker._id] : [],
    });
    return {
      slop,
      report: { ...report, actions: report.actions.filter((action) => MAKER_ACTIONS.has(action.name)) },
      truncated,
      days: Math.floor((range.to - range.from) / DAY_MS),
    };
  },
});

/** The slop at `/@username/slug`, for pages that load a report by address. */
export const slopIdAt = query({
  args: { username: v.string(), slug: v.string() },
  handler: async (ctx, { username, slug }): Promise<Id<"slops"> | null> => {
    await requireServer(ctx);
    const user = await ctx.db
      .query("users")
      .withIndex("by_username", (q) => q.eq("username", normalizeUsername(username)))
      .unique();
    if (!user) return null;
    const slop = await ctx.db
      .query("slops")
      .withIndex("by_user_slug", (q) => q.eq("userId", user._id).eq("slug", slug))
      .unique();
    return slop?._id ?? null;
  },
});

// Feature flags and experiments: definitions live in the analytics component;
// the app server evaluates flags where it renders (app/.server/flags.ts).

/** Active flags, for the app server to evaluate (it caches them). */
export const flagDefinitions = query({
  args: {},
  handler: async (ctx): Promise<FlagDefinition[]> => {
    await requireServer(ctx);
    return await ctx.runQuery(components.analytics.flags.definitions, {});
  },
});

export const flags = query({
  args: { adminId: v.id("users") },
  handler: async (ctx, { adminId }) => {
    await requireAnalytics(ctx, adminId);
    return await ctx.runQuery(components.analytics.flags.list, {});
  },
});

export const flag = query({
  args: { adminId: v.id("users"), key: v.string() },
  handler: async (ctx, { adminId, key }) => {
    await requireAnalytics(ctx, adminId);
    const [found, experiments] = await Promise.all([
      ctx.runQuery(components.analytics.flags.get, { key }),
      ctx.runQuery(components.analytics.experiments.list, {}),
    ]);
    return found ? { flag: found, experiments: experiments.filter((experiment) => experiment.flagKey === key) } : null;
  },
});

const flagInput = v.object({
  key: v.string(),
  name: v.string(),
  description: v.string(),
  active: v.boolean(),
  variants: v.union(v.array(flagVariantValidator), v.null()),
  conditions: v.array(flagConditionValidator),
  payloads: v.record(v.string(), v.string()),
});

async function requireAnalyticsManager(ctx: MutationCtx, adminId: Id<"users">): Promise<void> {
  await requireServer(ctx);
  await requirePermission(ctx, adminId, "analytics.manage");
}

/** Makes a flag, or changes one (keeping whether it's on). */
export const saveFlag = mutation({
  args: { adminId: v.id("users"), flag: flagInput },
  handler: async (ctx, { adminId, flag }): Promise<{ created: boolean }> => {
    await requireAnalyticsManager(ctx, adminId);
    const existing = await ctx.runQuery(components.analytics.flags.get, { key: flag.key });
    const saved = await ctx.runMutation(components.analytics.flags.save, {
      ...flag,
      active: existing?.active ?? flag.active,
    });
    await logStaffAction(ctx, adminId, { type: "flag", change: saved.created ? "created" : "changed" }, flag.key);
    return saved;
  },
});

export const setFlagActive = mutation({
  args: { adminId: v.id("users"), key: v.string(), active: v.boolean() },
  handler: async (ctx, { adminId, key, active }): Promise<boolean> => {
    await requireAnalyticsManager(ctx, adminId);
    const changed = await ctx.runMutation(components.analytics.flags.setActive, { key, active });
    if (changed) await logStaffAction(ctx, adminId, { type: "flag", change: active ? "on" : "off" }, key);
    return changed;
  },
});

export const removeFlag = mutation({
  args: { adminId: v.id("users"), key: v.string() },
  handler: async (ctx, { adminId, key }): Promise<boolean> => {
    await requireAnalyticsManager(ctx, adminId);
    const removed = await ctx.runMutation(components.analytics.flags.remove, { key });
    if (removed) await logStaffAction(ctx, adminId, { type: "flag", change: "deleted" }, key);
    return removed;
  },
});

export const experiments = query({
  args: { adminId: v.id("users") },
  handler: async (ctx, { adminId }) => {
    await requireAnalytics(ctx, adminId);
    return await ctx.runQuery(components.analytics.experiments.list, {});
  },
});

/** An experiment and how its variants are converting. */
export const experimentResults = action({
  args: { adminId: v.id("users"), key: v.string() },
  handler: async (ctx, { adminId, key }): Promise<ExperimentAnswer | null> => {
    await requireAnalyticsAction(ctx, adminId);
    return await analytics.experiment(ctx, key);
  },
});

export const saveExperiment = mutation({
  args: {
    adminId: v.id("users"),
    experiment: v.object({
      key: v.string(),
      name: v.string(),
      hypothesis: v.string(),
      flagKey: v.string(),
      goal: v.object({ event: v.string(), filters: v.array(propertyFilterValidator) }),
    }),
  },
  handler: async (ctx, { adminId, experiment }): Promise<{ created: boolean }> => {
    await requireAnalyticsManager(ctx, adminId);
    const saved = await ctx.runMutation(components.analytics.experiments.save, experiment);
    await logStaffAction(
      ctx,
      adminId,
      { type: "experiment", change: saved.created ? "created" : "changed" },
      experiment.key,
    );
    return saved;
  },
});

export const startExperiment = mutation({
  args: { adminId: v.id("users"), key: v.string() },
  handler: async (ctx, { adminId, key }) => {
    await requireAnalyticsManager(ctx, adminId);
    await ctx.runMutation(components.analytics.experiments.start, { key });
    await logStaffAction(ctx, adminId, { type: "experiment", change: "started" }, key);
  },
});

export const stopExperiment = mutation({
  args: { adminId: v.id("users"), key: v.string() },
  handler: async (ctx, { adminId, key }) => {
    await requireAnalyticsManager(ctx, adminId);
    await ctx.runMutation(components.analytics.experiments.stop, { key });
    await logStaffAction(ctx, adminId, { type: "experiment", change: "stopped" }, key);
  },
});

export const removeExperiment = mutation({
  args: { adminId: v.id("users"), key: v.string() },
  handler: async (ctx, { adminId, key }): Promise<boolean> => {
    await requireAnalyticsManager(ctx, adminId);
    const removed = await ctx.runMutation(components.analytics.experiments.remove, { key });
    if (removed) await logStaffAction(ctx, adminId, { type: "experiment", change: "deleted" }, key);
    return removed;
  },
});
