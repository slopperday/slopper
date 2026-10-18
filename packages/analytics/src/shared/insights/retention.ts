import type { RetentionQuery } from "./queries";
import type { EventRow } from "./rows";
import { bucketsIn, bucketStart, type Interval, nextBucket } from "./time";

export interface RetentionCohort {
  /** When the cohort did the start event for the first time in the range. */
  start: number;
  size: number;
  /**
   * People back in each period after the first: `retained[0]` is the
   * cohort's own period (everyone), `retained[k]` the k-th after it. Periods
   * that haven't begun yet are left off.
   */
  retained: number[];
}

export interface RetentionResult {
  kind: "retention";
  interval: Interval;
  cohorts: RetentionCohort[];
  /** For each period, the share of people back, across the cohorts that have reached it (0 to 1). */
  average: number[];
}

/**
 * Retention: people join the cohort of the period they first did the start
 * event in (within the range), and count as retained in a later period if
 * they did the return event in it. Feed start events with `addStart` and
 * return events with `addReturn`, in any order.
 */
export class RetentionAggregator {
  private readonly firstStart = new Map<string, number>();
  private readonly returns = new Map<string, Set<number>>();

  constructor(
    private readonly query: RetentionQuery,
    private readonly now: number,
  ) {}

  addStart(event: EventRow): void {
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    const bucket = bucketStart(event.timestamp, this.query.interval);
    const first = this.firstStart.get(event.personId);
    if (first === undefined || bucket < first) this.firstStart.set(event.personId, bucket);
  }

  addReturn(event: EventRow): void {
    if (event.timestamp < this.query.range.from) return;
    let buckets = this.returns.get(event.personId);
    if (!buckets) {
      buckets = new Set();
      this.returns.set(event.personId, buckets);
    }
    buckets.add(bucketStart(event.timestamp, this.query.interval));
  }

  result(): RetentionResult {
    const { interval } = this.query;
    const periods = Math.max(1, Math.floor(this.query.periods));
    const cohorts = bucketsIn(this.query.range, interval).map((start) => {
      // The start of each period this cohort is followed for, up to now.
      const starts: number[] = [];
      for (let at = start, k = 0; k < periods && at <= this.now; at = nextBucket(at, interval), k += 1) starts.push(at);
      return { start, size: 0, retained: starts.map(() => 0), starts };
    });
    const byStart = new Map(cohorts.map((cohort) => [cohort.start, cohort]));
    for (const [personId, first] of this.firstStart) {
      const cohort = byStart.get(first);
      if (!cohort) continue;
      cohort.size += 1;
      cohort.retained[0] = (cohort.retained[0] ?? 0) + 1;
      const back = this.returns.get(personId);
      if (!back) continue;
      cohort.starts.forEach((at, k) => {
        if (k > 0 && back.has(at)) cohort.retained[k] = (cohort.retained[k] ?? 0) + 1;
      });
    }
    const average = Array.from({ length: periods }, (_, k) => {
      let people = 0;
      let retained = 0;
      for (const cohort of cohorts) {
        if (k >= cohort.retained.length || cohort.size === 0) continue;
        people += cohort.size;
        retained += cohort.retained[k] ?? 0;
      }
      return people === 0 ? 0 : retained / people;
    });
    return {
      kind: "retention",
      interval,
      cohorts: cohorts.map(({ start, size, retained }) => ({ start, size, retained })),
      average,
    };
  }
}
