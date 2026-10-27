import {
  type GenericActionCtx,
  type GenericDataModel,
  type GenericMutationCtx,
  type GenericQueryCtx,
  httpActionGeneric,
  type HttpRouter,
} from "convex/server";
import type { ComponentApi } from "../component/_generated/component";
import { BATCH_LIMITS, EVENTS, isBrowserEvent, parseBatch } from "../shared/events";
import type { GroupReport, GroupReportQuery, InsightAnswer, InsightQuery } from "../shared/insights";
import type { Properties } from "../shared/properties";
import { ROUTES } from "../shared/routes";
import { hostOf } from "../shared/source";
import { isBot, parseUserAgent } from "../shared/userAgent";
import { parseReplayChunkParams, REPLAY_LIMITS } from "../shared/replay";
import { type ExperimentAnswer, experimentResults } from "./experiments";
import { groupReport, type Overview, overview, runInsight } from "./insights";
import { rollUp, type RollUpOptions, type RollUpResult } from "./rollups";

/**
 * What an app's own Convex functions use: the HTTP endpoints the SDK sends
 * to, and capturing events from server code. See the package README.
 */

export type AnalyticsComponent = ComponentApi;

type RunQueryCtx = Pick<GenericQueryCtx<GenericDataModel>, "runQuery">;
type RunMutationCtx = Pick<GenericMutationCtx<GenericDataModel>, "runQuery" | "runMutation">;
type RunActionCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation" | "runAction">;

export type { RunActionCtx, RunMutationCtx, RunQueryCtx };

/** An event from server code: something a person did that no browser saw, or that mustn't be lost. */
export interface ServerEvent {
  name: string;
  /** Whose it is: for signed-in people, the same id the browser identifies them with. */
  distinctId: string;
  properties?: Properties;
  /** Person properties to set. */
  set?: Properties;
  /** Person properties to set only if they have none yet. */
  setOnce?: Properties;
  /** Defaults to now. */
  timestamp?: number;
  /** The distinct id is an account's: its person counts as signed in. */
  identified?: boolean;
  /** What it's about, `type:id`, like the slop that was voted on (group analytics). */
  group?: string;
  /** The page it happened on, if any. */
  path?: string;
}

export interface Retention {
  eventDays: number;
  personDays: number;
  /** Session recordings: 30 days unless set. */
  recordingDays?: number;
}

export interface BrowserIdentity {
  /** Proven by the request's authentication, never by its event payload. */
  accountId: string | null;
  /** Unidentified ids in a namespace disjoint from account ids. */
  anonymousIds: readonly string[];
}

export interface RouteOptions {
  /** Resolves browser claims against the app's authenticated identity and account-id namespace. */
  browserIdentity?: (ctx: GenericActionCtx<GenericDataModel>, ids: string[]) => Promise<BrowserIdentity>;
  /** Where the endpoints live on the deployment's `.convex.site` URL: `ROUTES.prefix` unless set. */
  pathPrefix?: string;
  /** Origins browsers may send from, like `https://slopper.day`; "*" for any. */
  allowedOrigins: readonly string[] | "*";
  /**
   * What the pages in a batch are about, for group analytics: each path the
   * app recognizes, mapped to `type:id` ("/@ifiok/tiltmaze" to "slop:abc").
   * Every event on that page (views, clicks, leaves) joins the group. Paths
   * it leaves out stay ungrouped.
   */
  groupsForPaths?: (ctx: RunActionCtx, paths: string[]) => Promise<ReadonlyMap<string, string>>;
}

export class Analytics {
  constructor(readonly component: AnalyticsComponent) {}

  /** Records an event from a mutation or action, in the same transaction as a mutation's other writes. */
  async capture(ctx: RunMutationCtx, event: ServerEvent): Promise<void> {
    await ctx.runMutation(this.component.ingest.capture, event);
  }

  /** Deletes everything about the person behind `distinctId`. */
  async forget(ctx: RunMutationCtx, distinctId: string): Promise<boolean> {
    return await ctx.runMutation(this.component.persons.forget, { distinctId });
  }

  /**
   * Answers an insight (trends, funnels, retention, paths, stickiness,
   * lifecycle, web analytics). Reads page by page, so run it from an action.
   */
  async insight(ctx: RunActionCtx, query: InsightQuery, now: number = Date.now()): Promise<InsightAnswer> {
    return await runInsight(ctx, this.component, query, now);
  }

  /** Everything about one group (`type:id`): views, people, sources, clicks, actions. From an action. */
  async groupReport(ctx: RunActionCtx, query: GroupReportQuery): Promise<{ report: GroupReport; truncated: boolean }> {
    return await groupReport(ctx, this.component, query);
  }

  /** An experiment and how its variants are converting, from its flag's exposures and its goal. From an action. */
  async experiment(ctx: RunActionCtx, key: string, now: number = Date.now()): Promise<ExperimentAnswer | null> {
    return await experimentResults(ctx, this.component, key, now);
  }

  /** How many people there are, how many signed in, and how many were active lately. From an action. */
  async overview(ctx: RunActionCtx, now: number = Date.now()): Promise<Overview> {
    return await overview(ctx, this.component, now);
  }

  /**
   * Rolls up the days that need it into the daily aggregates the dashboards
   * read: yesterday and any recent day not done yet, and older days that
   * changed. Run it daily from an action on a cron, and call again while it
   * says there's `more` (a long `lookbackDays` backfills).
   */
  async rollUp(ctx: RunActionCtx, options?: RollUpOptions): Promise<RollUpResult> {
    return await rollUp(ctx, this.component, options);
  }

  /** Deletes what's past `retention`; run it daily from a cron. */
  async sweep(ctx: RunMutationCtx, retention: Retention): Promise<void> {
    await ctx.runMutation(this.component.maintenance.sweep, { retention });
  }

  /** Mounts the endpoints the browser SDK sends to on the app's HTTP router. */
  registerRoutes(http: HttpRouter, options: RouteOptions): void {
    const resolveIdentity = async (ctx: GenericActionCtx<GenericDataModel>, ids: string[]): Promise<BrowserIdentity> =>
      options.browserIdentity
        ? await options.browserIdentity(ctx, ids)
        : {
            accountId: null,
            anonymousIds: ids.filter((id) =>
              /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id),
            ),
          };
    const prefix = (options.pathPrefix ?? ROUTES.prefix).replace(/\/+$/, "");
    const allowed = (origin: string | null) =>
      options.allowedOrigins === "*" || (origin !== null && options.allowedOrigins.includes(origin));
    const corsHeaders = (origin: string | null): Record<string, string> =>
      origin && allowed(origin) ? { "access-control-allow-origin": origin, vary: "Origin" } : {};

    for (const route of [ROUTES.events, ROUTES.recordings]) {
      http.route({
        path: `${prefix}${route}`,
        method: "OPTIONS",
        handler: httpActionGeneric(async (_ctx, request) => {
          const origin = request.headers.get("origin");
          if (!allowed(origin)) return new Response(null, { status: 403 });
          return new Response(null, {
            status: 204,
            headers: {
              ...corsHeaders(origin),
              "access-control-allow-methods": "POST",
              "access-control-allow-headers": "content-type, authorization",
              "access-control-max-age": "86400",
            },
          });
        }),
      });
    }

    http.route({
      path: `${prefix}${ROUTES.events}`,
      method: "POST",
      handler: httpActionGeneric(async (ctx, request) => {
        const origin = request.headers.get("origin");
        if (!allowed(origin)) return new Response(null, { status: 403 });
        const headers = corsHeaders(origin);
        const userAgent = request.headers.get("user-agent") ?? "";
        // Crawlers get a success they won't retry, and nothing is stored.
        if (isBot(userAgent)) return new Response(null, { status: 204, headers });
        const body = await request.text();
        if (body.length > BATCH_LIMITS.bytes) return new Response(null, { status: 413, headers });
        let input: unknown;
        try {
          input = JSON.parse(body);
        } catch {
          return new Response(null, { status: 400, headers });
        }
        const batch = parseBatch(input, Date.now());
        if (batch.events.length === 0) return Response.json({ stored: 0, dropped: batch.dropped }, { headers });
        const ids = [
          ...new Set(
            batch.events.flatMap((event) => {
              const anonymous = event.properties.anonDistinctId;
              return typeof anonymous === "string" ? [event.distinctId, anonymous] : [event.distinctId];
            }),
          ),
        ];
        const identity = await resolveIdentity(ctx, ids);
        if (request.headers.has("authorization") && identity.accountId === null) {
          return new Response(null, { status: 401, headers });
        }
        const anonymousIds = new Set(identity.anonymousIds);
        const accepted = batch.events.filter((event) => {
          if (!isBrowserEvent(event.name)) return false;
          if (event.distinctId !== identity.accountId && !anonymousIds.has(event.distinctId)) return false;
          if (event.name !== EVENTS.identify) return true;
          if (event.distinctId !== identity.accountId) return false;
          const anonymous = event.properties.anonDistinctId;
          return (
            anonymous === undefined ||
            (typeof anonymous === "string" &&
              anonymous.length > 0 &&
              anonymous.length <= BATCH_LIMITS.idLength &&
              anonymousIds.has(anonymous))
          );
        });
        batch.dropped += batch.events.length - accepted.length;
        const paths = [...new Set(accepted.flatMap((event) => (event.path ? [event.path] : [])))];
        const groups = options.groupsForPaths && paths.length > 0 ? await options.groupsForPaths(ctx, paths) : null;
        const events = groups
          ? accepted.map((event) => ({ ...event, group: (event.path && groups.get(event.path)) || null }))
          : accepted;
        const result = await ctx.runMutation(this.component.ingest.batch, {
          events,
          accountId: identity.accountId ?? undefined,
          context: { device: parseUserAgent(userAgent), ownHost: origin ? hostOf(origin) : null },
        });
        return Response.json({ ...result, dropped: batch.dropped }, { headers });
      }),
    });

    http.route({
      path: `${prefix}${ROUTES.recordings}`,
      method: "POST",
      handler: httpActionGeneric(async (ctx, request) => {
        const origin = request.headers.get("origin");
        if (!allowed(origin)) return new Response(null, { status: 403 });
        const headers = corsHeaders(origin);
        if (isBot(request.headers.get("user-agent") ?? "")) return new Response(null, { status: 204, headers });
        const meta = parseReplayChunkParams(new URL(request.url).searchParams);
        if (!meta) return new Response(null, { status: 400, headers });
        const identity = await resolveIdentity(ctx, [meta.distinctId]);
        if (request.headers.has("authorization") && identity.accountId === null) {
          return new Response(null, { status: 401, headers });
        }
        if (meta.distinctId !== identity.accountId && !identity.anonymousIds.includes(meta.distinctId)) {
          return new Response(null, { status: 403, headers });
        }
        if (Number(request.headers.get("content-length") ?? 0) > REPLAY_LIMITS.chunkBytes) {
          return new Response(null, { status: 413, headers });
        }
        const data = await request.arrayBuffer();
        if (data.byteLength > REPLAY_LIMITS.chunkBytes) return new Response(null, { status: 413, headers });
        // A skewed clock moves a chunk's times the way it moves events' (parseBatch).
        const now = Date.now();
        const skew = now - meta.sentAt;
        const startedAt = Math.min(meta.startedAt + skew, now);
        if (startedAt < now - REPLAY_LIMITS.maxAgeMs) return Response.json({ stored: false }, { headers });
        const stored = await ctx.runAction(this.component.recordings.store, {
          accountId: identity.accountId ?? undefined,
          sessionId: meta.sessionId,
          distinctId: meta.distinctId,
          startedAt,
          endedAt: Math.max(startedAt, Math.min(meta.endedAt + skew, now)),
          events: meta.events,
          encoding: meta.encoding,
          data,
        });
        return Response.json({ stored }, { headers });
      }),
    });
  }
}

export { checkRange, MAX_RANGE_DAYS, type Overview } from "./insights";
export { SCAN_LIMIT } from "./scanner";
export type { RollDayOutcome, RollUpOptions, RollUpResult } from "./rollups";
export * from "../shared/insights/queries";
export type * from "../shared/insights";
export type { Experiment, ExperimentAnswer } from "./experiments";
export * from "../shared/flags";
export * from "../shared/surveys";
