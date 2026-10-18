import type {
  ErrorsQuery,
  Vital,
  VitalsQuery,
  HeatmapDevice,
  HeatmapQuery,
  InsightQuery,
  Interval,
  PropertyFilter,
} from "@slopperday/analytics/shared/insights";
import { sanitizeAnalyticsPath } from "./analytics";

/**
 * Insights as plain parameters, the same for a /analytics/insights URL
 * and an agent's request: `kind`, `days`, `event` (repeatable) and a few
 * more per kind. Anything missing or out of range falls back to a default,
 * so a hand-edited URL still shows something.
 */

export const INSIGHT_KINDS = [
  "trends",
  "funnel",
  "retention",
  "paths",
  "stickiness",
  "lifecycle",
  "web",
  "groups",
] as const;
export type InsightKind = (typeof INSIGHT_KINDS)[number];

export const INSIGHT_LABELS: Record<InsightKind, string> = {
  trends: "Trends",
  funnel: "Funnel",
  retention: "Retention",
  paths: "Journeys",
  stickiness: "Stickiness",
  lifecycle: "Lifecycle",
  web: "Web",
  groups: "Projects",
};

/** Slops are the groups Slopper tags events with (convex/http.ts): `slop:<id>`. */
export const SLOP_GROUP = "slop:";

export const DAY_CHOICES = [7, 30, 90, 180, 365] as const;
const MAX_DAYS = 365;
const MAX_SERIES = 4;
const MAX_STEPS = 6;

/** Reads one parameter (the first value) or all of a repeated one. */
export interface Params {
  get(key: string): string | null;
  getAll(key: string): string[];
}

/** Params from a JSON object, as agents send them: strings, numbers, or lists of them. */
export function paramsFromObject(input: Record<string, unknown>): Params {
  const list = (key: string): string[] => {
    const value = input[key];
    const values = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
    return values.flatMap((item) => (typeof item === "string" || typeof item === "number" ? [String(item)] : []));
  };
  return { get: (key) => list(key)[0] ?? null, getAll: list };
}

export function isInsightKind(value: string | null): value is InsightKind {
  return INSIGHT_KINDS.some((kind) => kind === value);
}

function integer(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function text(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 200) : null;
}

/** Days for every kind: how far back from now the range starts. */
export function daysOf(params: Params): number {
  return integer(params.get("days"), 30, 1, MAX_DAYS);
}

/** The interval asked for, or one that keeps a chart readable for the range. */
export function intervalOf(params: Params, days: number): Interval {
  const asked = params.get("interval");
  if (asked === "day" || asked === "week" || asked === "month") return asked;
  return days <= 31 ? "day" : days <= 180 ? "week" : "month";
}

function events(params: Params, fallback: string, max: number): string[] {
  const named = params
    .getAll("event")
    .map((event) => text(event))
    .filter((event): event is string => event !== null);
  return (named.length > 0 ? named : [fallback]).slice(0, max);
}

function pathFilter(path: string | null): PropertyFilter[] | undefined {
  const value = text(path);
  return value ? [{ key: "path", operator: "equals", value }] : undefined;
}

export const HEATMAP_DEVICE_LABELS: Record<HeatmapDevice, string> = {
  mobile: "Phone",
  tablet: "Tablet",
  desktop: "Desktop",
};

export const VITAL_LABELS: Record<Vital, string> = {
  lcp: "Largest paint (LCP)",
  inp: "Response to input (INP)",
  cls: "Layout shift (CLS)",
  fcp: "First paint (FCP)",
  ttfb: "Server response (TTFB)",
};

/** A vital's value as people read it: seconds from a second up, milliseconds below, CLS as it is. */
export function formatVital(vital: Vital, value: number): string {
  if (vital === "cls") return value.toFixed(2);
  return value >= 1_000 ? `${(value / 1_000).toFixed(1)} s` : `${Math.round(value)} ms`;
}

/** Core Web Vitals over `days`. */
export function vitalsQuery(params: Params, now: number): VitalsQuery {
  return { kind: "vitals", range: { from: now - daysOf(params) * 86_400_000, to: now + 1 } };
}

/** Errors over `days`, grouped into issues; with `fingerprint`, one issue. */
export function errorsQuery(params: Params, now: number, fingerprint?: string): ErrorsQuery {
  return {
    kind: "errors",
    range: { from: now - daysOf(params) * 86_400_000, to: now + 1 },
    ...(fingerprint ? { fingerprint } : {}),
  };
}

/** A heatmap from `path` (one of the site's own, "/" unless given), `device` and `days`. */
export function heatmapQuery(params: Params, now: number): HeatmapQuery {
  const asked = params.get("device");
  const device: HeatmapDevice = asked === "mobile" || asked === "tablet" ? asked : "desktop";
  const typed = text(params.get("path")) ?? "/";
  const path = typed.startsWith("/") && !typed.startsWith("//") ? typed.split(/[?#]/)[0] || "/" : "/";
  return {
    kind: "heatmap",
    range: { from: now - daysOf(params) * 86_400_000, to: now + 1 },
    // Events keep private path segments rewritten, so the heatmap asks for the same.
    path: sanitizeAnalyticsPath(path),
    device,
  };
}

export function insightQuery(kind: InsightKind, params: Params, now: number): InsightQuery {
  const days = daysOf(params);
  // Up to and including now: a range's end is exclusive.
  const range = { from: now - days * 86_400_000, to: now + 1 };
  const interval = intervalOf(params, days);
  switch (kind) {
    case "trends": {
      const asked = params.get("math");
      const math = asked === "persons" || asked === "sessions" ? asked : "total";
      const breakdown = text(params.get("breakdown"));
      return {
        kind,
        range,
        interval,
        series: events(params, "$pageview", MAX_SERIES).map((event) => ({ event, math })),
        ...(breakdown ? { breakdown } : {}),
        ...(params.get("compare") === "1" ? { compare: true } : {}),
      };
    }
    case "funnel": {
      const paths = params.getAll("stepPath");
      return {
        kind,
        range,
        windowDays: integer(params.get("window"), 7, 1, 90),
        steps: events(params, "$pageview", MAX_STEPS).map((event, index) => {
          const filters = pathFilter(paths[index] ?? null);
          return filters ? { event, filters } : { event };
        }),
      };
    }
    case "retention":
      return {
        kind,
        range,
        interval: params.get("interval") === "day" ? "day" : "week",
        startEvent: text(params.get("start")) ?? "$pageview",
        returnEvent: text(params.get("return")) ?? "$pageview",
        periods: integer(params.get("periods"), 8, 2, 26),
      };
    case "paths": {
      const startPath = text(params.get("start"));
      const endPath = text(params.get("end"));
      return {
        kind,
        range,
        steps: integer(params.get("steps"), 5, 2, 10),
        ...(startPath ? { startPath } : {}),
        ...(endPath ? { endPath } : {}),
      };
    }
    case "stickiness":
      return { kind, range, event: events(params, "$pageview", 1)[0] ?? "$pageview" };
    case "lifecycle":
      return {
        kind,
        range,
        interval,
        event: events(params, "$pageview", 1)[0] ?? "$pageview",
      };
    case "web":
      return { kind, range, interval };
    case "groups":
      return { kind, range, event: events(params, "$pageview", 1)[0] ?? "$pageview", prefix: SLOP_GROUP };
  }
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const whole = new Intl.NumberFormat("en");

/** 950, 12,340, then 1.2M: exact until numbers get long. */
export function formatCount(value: number): string {
  return Math.abs(value) < 100_000 ? whole.format(value) : compact.format(value);
}

/** A share from 0 to 1 as a percentage, with a decimal only when it's small. */
export function formatPercent(share: number): string {
  const percent = share * 100;
  return `${percent > 0 && percent < 10 ? percent.toFixed(1) : Math.round(percent)}%`;
}

/** 45s, 3m 05s, 2h 10m. */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** The change from `previous` to `current` as "+12%", "−8%", or null when there's nothing to compare with. */
export function formatChange(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const change = Math.round(((current - previous) / previous) * 100);
  return change === 0 ? "±0%" : `${change > 0 ? "+" : "−"}${Math.abs(change)}%`;
}

/** A bucket's label: "Oct 12" for days and weeks, "Oct 2026" for months (UTC, like the buckets). */
export function formatBucket(start: number, interval: Interval): string {
  return new Date(start).toLocaleDateString("en", {
    timeZone: "UTC",
    month: "short",
    ...(interval === "month" ? { year: "numeric" } : { day: "numeric" }),
  });
}

/** How a person is named on the analytics pages: their username, or the end of their random id. */
export function personName(username: string | null, distinctIds: readonly string[]): string {
  return username ? `@${username}` : `Visitor ${(distinctIds[0] ?? "").slice(-8)}`;
}

/** What the SDK's own events are called on the analytics pages. */
const EVENT_LABELS: Record<string, string> = {
  $pageview: "Page view",
  $pageleave: "Left a page",
  $autocapture: "Click, change or submit",
  $rageclick: "Rage click",
  $heatmap: "Clicks for the heatmap",
  $identify: "Signed in",
  $exception: "Error",
  $webVitals: "Page speed",
  $featureFlagCalled: "Saw a flag",
  $surveyShown: "Saw a survey",
  $surveySent: "Answered a survey",
  $surveyDismissed: "Dismissed a survey",
};

/** An event's name as people read it: the SDK's in words, an app's own as they are. */
export function eventLabel(name: string): string {
  return EVENT_LABELS[name] ?? name;
}

const SHARE_NAMES: Record<string, string> = { x: "X", linkedin: "LinkedIn", bluesky: "Bluesky", threads: "Threads" };

/**
 * What was clicked on a slop's page, in words: the names the slop page gives
 * its links and buttons (`data-capture`), or the address of a link off the site.
 */
export function clickLabel(value: string, linkLabel: (kind: string) => string | null): string {
  const [kind, detail = ""] = value.split(":", 2);
  switch (kind) {
    case "try":
      return `Try it (${linkLabel(detail) ?? detail})`;
    case "link":
      return `${linkLabel(detail) ?? detail} link`;
    case "share":
      return `Shared on ${SHARE_NAMES[detail] ?? detail}`;
    case "upvote":
      return "Upvote";
    case "screenshot":
      return "A screenshot";
    default:
      return value;
  }
}
