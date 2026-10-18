import type { StickinessQuery } from "./queries";
import type { EventRow } from "./rows";
import { bucketsIn, bucketStart } from "./time";

export interface StickinessResult {
  kind: "stickiness";
  /** Days in the range. */
  days: number;
  /** `persons[d - 1]`: how many people did it on exactly `d` days. */
  persons: number[];
}

/** How many days in the range each person did something. Feed the event with `add`. */
export class StickinessAggregator {
  private readonly days = new Map<string, Set<number>>();

  constructor(private readonly query: StickinessQuery) {}

  add(event: EventRow): void {
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    let days = this.days.get(event.personId);
    if (!days) {
      days = new Set();
      this.days.set(event.personId, days);
    }
    days.add(bucketStart(event.timestamp, "day"));
  }

  result(): StickinessResult {
    const total = bucketsIn(this.query.range, "day").length;
    const persons = Array.from({ length: total }, () => 0);
    for (const days of this.days.values()) {
      const index = Math.min(days.size, total) - 1;
      persons[index] = (persons[index] ?? 0) + 1;
    }
    return { kind: "stickiness", days: total, persons };
  }
}
