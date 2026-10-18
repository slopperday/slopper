import type { FunctionReturnType, GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component";
import { EVENTS } from "../shared/events";
import { bucketOf } from "../shared/hash";
import { ExperimentAggregator, type ExperimentResult } from "../shared/insights";
import { Scanner } from "./insights";

type ScanCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;

export type Experiment = NonNullable<FunctionReturnType<ComponentApi["experiments"]["get"]>>;

export interface ExperimentAnswer {
  experiment: Experiment;
  /** Null until it starts. */
  result: ExperimentResult | null;
  truncated: boolean;
}

/**
 * An experiment and how it's going: who saw each variant of its flag
 * (`$featureFlagCalled`) from when it started to when it stopped (or now),
 * and who went on to do its goal.
 */
export async function experimentResults(
  ctx: ScanCtx,
  component: ComponentApi,
  key: string,
  now: number,
): Promise<ExperimentAnswer | null> {
  const experiment = await ctx.runQuery(component.experiments.get, { key });
  if (!experiment) return null;
  if (experiment.startedAt === null) return { experiment, result: null, truncated: false };
  const flag = await ctx.runQuery(component.flags.get, { key: experiment.flagKey });
  const variants = (flag?.variants ?? []).map((variant) => variant.key);
  const range = { from: experiment.startedAt, to: (experiment.endedAt ?? now) + 1 };
  const aggregator = new ExperimentAggregator({ flag: experiment.flagKey, variants, goal: experiment.goal, range });
  const scan = new Scanner(ctx, component);
  await scan.events(EVENTS.flagCalled, range, (row) => aggregator.addExposure(row));
  await scan.events(experiment.goal.event, range, (row) => aggregator.addGoal(row));
  // Seeded by the experiment, so the same counts always read the same.
  const seed = Math.floor(bucketOf(experiment.key) * 2 ** 31);
  return { experiment, result: aggregator.result(seed), truncated: scan.truncated };
}
