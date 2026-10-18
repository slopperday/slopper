import type { FunnelResult } from "./funnels";
import type { GroupsResult } from "./groups";
import type { HeatmapResult } from "./heatmap";
import type { LifecycleResult } from "./lifecycle";
import type { PathsResult } from "./paths";
import type { RetentionResult } from "./retention";
import type { StickinessResult } from "./stickiness";
import type { TrendsResult } from "./trends";
import type { WebResult } from "./web";

export * from "./experiments";
export * from "./funnels";
export * from "./groups";
export * from "./heatmap";
export * from "./lifecycle";
export * from "./paths";
export * from "./queries";
export * from "./retention";
export * from "./rows";
export * from "./stickiness";
export * from "./time";
export * from "./trends";
export * from "./web";

export type InsightResult =
  | TrendsResult
  | FunnelResult
  | RetentionResult
  | PathsResult
  | StickinessResult
  | LifecycleResult
  | WebResult
  | GroupsResult
  | HeatmapResult;

/** What an insight answers, and how much it read to answer it. */
export interface InsightAnswer<Result extends InsightResult = InsightResult> {
  result: Result;
  /** Events and sessions read. */
  scanned: number;
  /** True when there was more than the engine reads in one go: the numbers cover only part of the range. */
  truncated: boolean;
}
