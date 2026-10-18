import { type Infer, v } from "convex/values";

/**
 * What can be asked of the insights engine. The validators are the source of
 * truth: an app's Convex functions take queries through them, and the types
 * below come from them.
 */

/** In a query's event field: every event, whatever its name. */
export const ANY_EVENT = "*";

export const propertyFilterValidator = v.object({
  /** An event property, or `path` for the page it happened on. */
  key: v.string(),
  operator: v.union(
    v.literal("equals"),
    v.literal("notEquals"),
    v.literal("contains"),
    v.literal("notContains"),
    v.literal("isSet"),
    v.literal("isNotSet"),
    v.literal("greaterThan"),
    v.literal("lessThan"),
  ),
  value: v.optional(v.union(v.string(), v.number(), v.boolean())),
});

export const intervalValidator = v.union(v.literal("day"), v.literal("week"), v.literal("month"));

/** From (inclusive) to (exclusive), in ms since the epoch. */
export const rangeValidator = v.object({ from: v.number(), to: v.number() });

const filters = v.optional(v.array(propertyFilterValidator));

export const trendsMathValidator = v.union(v.literal("total"), v.literal("persons"), v.literal("sessions"));

/** How often things happen over time, or how many people or sessions they happen in. */
export const trendsQueryValidator = v.object({
  kind: v.literal("trends"),
  range: rangeValidator,
  interval: intervalValidator,
  series: v.array(v.object({ event: v.string(), math: trendsMathValidator, filters })),
  /** An event property (or `path`) to split each series by. */
  breakdown: v.optional(v.string()),
  /** Also count the period of the same length just before, bucket by bucket, to compare against. */
  compare: v.optional(v.boolean()),
});

/** How many people go through steps in order, within a window of the first. */
export const funnelQueryValidator = v.object({
  kind: v.literal("funnel"),
  range: rangeValidator,
  steps: v.array(v.object({ event: v.string(), filters })),
  windowDays: v.number(),
});

/** Of the people who did one thing, how many came back to do another, period by period. */
export const retentionQueryValidator = v.object({
  kind: v.literal("retention"),
  range: rangeValidator,
  interval: v.union(v.literal("day"), v.literal("week")),
  startEvent: v.string(),
  returnEvent: v.string(),
  periods: v.number(),
});

/** The routes people take through the pages, session by session. */
export const pathsQueryValidator = v.object({
  kind: v.literal("paths"),
  range: rangeValidator,
  /** Only journeys from this page on. */
  startPath: v.optional(v.string()),
  /** Only journeys that reach this page, and the pages before it. */
  endPath: v.optional(v.string()),
  steps: v.number(),
});

/** How many days in the range people did something: once, twice, every day. */
export const stickinessQueryValidator = v.object({
  kind: v.literal("stickiness"),
  range: rangeValidator,
  event: v.string(),
});

/** New, returning, resurrecting and dormant people, period by period. */
export const lifecycleQueryValidator = v.object({
  kind: v.literal("lifecycle"),
  range: rangeValidator,
  interval: intervalValidator,
  event: v.string(),
});

/** Visitors, sessions and page views, where they come from and what they use. */
export const webQueryValidator = v.object({
  kind: v.literal("web"),
  range: rangeValidator,
  interval: intervalValidator,
});

/** Every group (`type:id`) compared with the period before: which are rising, which falling. */
export const groupsQueryValidator = v.object({
  kind: v.literal("groups"),
  range: rangeValidator,
  event: v.string(),
  /** Only groups of one type, like "slop:". */
  prefix: v.optional(v.string()),
});

export const heatmapDeviceValidator = v.union(v.literal("mobile"), v.literal("tablet"), v.literal("desktop"));

/** Where people click on one page, and how far down they scroll, on one kind of screen. */
export const heatmapQueryValidator = v.object({
  kind: v.literal("heatmap"),
  range: rangeValidator,
  path: v.string(),
  device: heatmapDeviceValidator,
});

/** Errors grouped into issues; with `fingerprint`, one issue and its latest occurrences. */
export const errorsQueryValidator = v.object({
  kind: v.literal("errors"),
  range: rangeValidator,
  fingerprint: v.optional(v.string()),
});

/** Core Web Vitals from real visits: 75th percentiles and how many loads were good, overall and per page. */
export const vitalsQueryValidator = v.object({
  kind: v.literal("vitals"),
  range: rangeValidator,
});

/** One survey's results; `question` is its kind, which decides the average and the NPS. */
export const surveyQueryValidator = v.object({
  kind: v.literal("survey"),
  range: rangeValidator,
  key: v.string(),
  question: v.union(v.literal("rating"), v.literal("nps"), v.literal("choice"), v.literal("text")),
});

export const insightQueryValidator = v.union(
  trendsQueryValidator,
  funnelQueryValidator,
  retentionQueryValidator,
  pathsQueryValidator,
  stickinessQueryValidator,
  lifecycleQueryValidator,
  webQueryValidator,
  groupsQueryValidator,
  heatmapQueryValidator,
  errorsQueryValidator,
  vitalsQueryValidator,
  surveyQueryValidator,
);

export type PropertyFilter = Infer<typeof propertyFilterValidator>;
export type TrendsMath = Infer<typeof trendsMathValidator>;
export type TrendsQuery = Infer<typeof trendsQueryValidator>;
export type FunnelQuery = Infer<typeof funnelQueryValidator>;
export type RetentionQuery = Infer<typeof retentionQueryValidator>;
export type PathsQuery = Infer<typeof pathsQueryValidator>;
export type StickinessQuery = Infer<typeof stickinessQueryValidator>;
export type LifecycleQuery = Infer<typeof lifecycleQueryValidator>;
export type WebQuery = Infer<typeof webQueryValidator>;
export type GroupsQuery = Infer<typeof groupsQueryValidator>;
export type HeatmapQuery = Infer<typeof heatmapQueryValidator>;
export type HeatmapDevice = Infer<typeof heatmapDeviceValidator>;
export type ErrorsQuery = Infer<typeof errorsQueryValidator>;
export type VitalsQuery = Infer<typeof vitalsQueryValidator>;
export type SurveyQuery = Infer<typeof surveyQueryValidator>;
export type InsightQuery = Infer<typeof insightQueryValidator>;
