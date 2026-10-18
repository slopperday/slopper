import type { FunnelQuery } from "./queries";
import { type EventRow, matchesAll } from "./rows";
import { DAY_MS } from "./time";

export interface FunnelStepResult {
  event: string;
  /** People who got this far. */
  count: number;
  /** Of everyone who started, the share who got this far (0 to 1). */
  conversion: number;
  /** Of those who reached the step before, the share who reached this one. */
  stepConversion: number;
  /** The median time from the step before, for those who made it; null for the first step or when nobody did. */
  medianMsFromPrevious: number | null;
}

export interface FunnelResult {
  kind: "funnel";
  steps: FunnelStepResult[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] ?? null)
    : Math.round(((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2);
}

/** The first time in `sorted` at or after `from` and no later than `until`, or null. */
function firstBetween(sorted: number[], from: number, until: number): number | null {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((sorted[middle] ?? 0) < from) low = middle + 1;
    else high = middle;
  }
  const found = sorted[low];
  return found !== undefined && found <= until ? found : null;
}

/**
 * Funnels, fed each step's events (`add(stepIndex, event)`) in any order.
 * Someone enters by doing the first step within the range and converts
 * through each later step in order, all within the window of their first
 * step. Each person counts once, on their attempt that got furthest.
 */
export class FunnelAggregator {
  /** Per person, per step, when they did it. */
  private readonly times = new Map<string, number[][]>();
  private readonly windowMs: number;

  constructor(private readonly query: FunnelQuery) {
    this.windowMs = Math.max(0, query.windowDays) * DAY_MS;
  }

  add(stepIndex: number, event: EventRow): void {
    const step = this.query.steps[stepIndex];
    if (!step || !matchesAll(event, step.filters)) return;
    if (stepIndex === 0 && (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to)) return;
    let steps = this.times.get(event.personId);
    if (!steps) {
      steps = this.query.steps.map(() => []);
      this.times.set(event.personId, steps);
    }
    steps[stepIndex]?.push(event.timestamp);
  }

  result(): FunnelResult {
    const count = this.query.steps.map(() => 0);
    const gaps: number[][] = this.query.steps.map(() => []);
    for (const steps of this.times.values()) {
      for (const times of steps) times.sort((a, b) => a - b);
      let best: { reached: number; gaps: number[] } = { reached: 0, gaps: [] };
      for (const start of steps[0] ?? []) {
        const deadline = start + this.windowMs;
        let at = start;
        const attempt = { reached: 1, gaps: [] as number[] };
        for (let index = 1; index < steps.length; index += 1) {
          // Strictly after the previous step: the same moment isn't "then".
          const next = firstBetween(steps[index] ?? [], at + 1, deadline);
          if (next === null) break;
          attempt.gaps.push(next - at);
          attempt.reached += 1;
          at = next;
        }
        if (attempt.reached > best.reached) best = attempt;
        if (best.reached === steps.length) break;
      }
      for (let index = 0; index < best.reached; index += 1) {
        count[index] = (count[index] ?? 0) + 1;
        const gap = best.gaps[index - 1];
        if (index > 0 && gap !== undefined) gaps[index]?.push(gap);
      }
    }
    const entered = count[0] ?? 0;
    return {
      kind: "funnel",
      steps: this.query.steps.map((step, index) => {
        const reached = count[index] ?? 0;
        const before = index === 0 ? entered : (count[index - 1] ?? 0);
        return {
          event: step.event,
          count: reached,
          conversion: entered === 0 ? 0 : reached / entered,
          stepConversion: before === 0 ? 0 : reached / before,
          medianMsFromPrevious: index === 0 ? null : median(gaps[index] ?? []),
        };
      }),
    };
  }
}
