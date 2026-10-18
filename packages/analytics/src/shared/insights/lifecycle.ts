import type { LifecycleQuery } from "./queries";
import type { EventRow } from "./rows";
import { bucketsIn, bucketStart, type TimeRange } from "./time";

export interface LifecycleResult {
  kind: "lifecycle";
  buckets: number[];
  /** First seen in the period, and active in it. */
  new: number[];
  /** Active in the period and the one before. */
  returning: number[];
  /** Active in the period after sitting out the one before, and not new. */
  resurrecting: number[];
  /** Active in the period before, not in this one: counted as negative, as they're lost. */
  dormant: number[];
}

/**
 * Lifecycle: each period's active people sorted by what they did before.
 * Feed the event from one period before the range on (`scanRange`), so the
 * first period knows who was active before it; `result` takes when each
 * person was first seen.
 */
export class LifecycleAggregator {
  private readonly active = new Map<string, Set<number>>();
  private readonly buckets: number[];

  constructor(private readonly query: LifecycleQuery) {
    this.buckets = bucketsIn(query.range, query.interval);
  }

  /** What to feed: the range, and the period before it. */
  static scanRange(query: LifecycleQuery): TimeRange {
    const first = bucketStart(query.range.from, query.interval);
    const before = bucketStart(first - 1, query.interval);
    return { from: before, to: query.range.to };
  }

  /** The people active in the range: their first-seen times are what `result` needs. */
  get people(): string[] {
    return [...this.active.keys()];
  }

  add(event: EventRow): void {
    if (event.timestamp >= this.query.range.to) return;
    let buckets = this.active.get(event.personId);
    if (!buckets) {
      buckets = new Set();
      this.active.set(event.personId, buckets);
    }
    buckets.add(bucketStart(event.timestamp, this.query.interval));
  }

  result(firstSeen: ReadonlyMap<string, number>): LifecycleResult {
    const { interval } = this.query;
    const zeros = () => this.buckets.map(() => 0);
    const result: LifecycleResult = {
      kind: "lifecycle",
      buckets: this.buckets,
      new: zeros(),
      returning: zeros(),
      resurrecting: zeros(),
      dormant: zeros(),
    };
    for (const [personId, buckets] of this.active) {
      const created = firstSeen.get(personId);
      const createdBucket = created === undefined ? null : bucketStart(created, interval);
      this.buckets.forEach((bucket, index) => {
        const previous = bucketStart(bucket - 1, interval);
        const now = buckets.has(bucket);
        const before = buckets.has(previous);
        if (now && createdBucket === bucket) result.new[index] = (result.new[index] ?? 0) + 1;
        else if (now && before) result.returning[index] = (result.returning[index] ?? 0) + 1;
        else if (now) result.resurrecting[index] = (result.resurrecting[index] ?? 0) + 1;
        else if (before) result.dormant[index] = (result.dormant[index] ?? 0) - 1;
      });
    }
    return result;
  }
}
