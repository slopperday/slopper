/**
 * Time buckets for insights, in UTC: a day starts at midnight UTC, a week on
 * Monday (ISO 8601), a month on its first day.
 */

export type Interval = "day" | "week" | "month";

export const DAY_MS = 86_400_000;
export const WEEK_MS = 7 * DAY_MS;

/** A span of time, from `from` (inclusive) to `to` (exclusive), in ms since the epoch. */
export interface TimeRange {
  from: number;
  to: number;
}

export function bucketStart(timestamp: number, interval: Interval): number {
  const date = new Date(timestamp);
  const day = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  switch (interval) {
    case "day":
      return day;
    case "week": {
      // getUTCDay: Sunday is 0. ISO weeks start on Monday.
      const sinceMonday = (date.getUTCDay() + 6) % 7;
      return day - sinceMonday * DAY_MS;
    }
    case "month":
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
  }
}

export function nextBucket(start: number, interval: Interval): number {
  switch (interval) {
    case "day":
      return start + DAY_MS;
    case "week":
      return start + WEEK_MS;
    case "month": {
      const date = new Date(start);
      return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
    }
  }
}

/** The start of every bucket that overlaps `range`, in order. */
export function bucketsIn(range: TimeRange, interval: Interval): number[] {
  const starts: number[] = [];
  for (let start = bucketStart(range.from, interval); start < range.to; start = nextBucket(start, interval)) {
    starts.push(start);
  }
  return starts;
}

/** The `days` before `now`, ending at `now`. */
export function lastDays(days: number, now: number): TimeRange {
  return { from: now - days * DAY_MS, to: now };
}

/** The range of the same length just before `range`, for "compared to the previous period". */
export function previousRange(range: TimeRange): TimeRange {
  return { from: range.from - (range.to - range.from), to: range.from };
}

/** Whether the day starting at `day` lies wholly inside `range`. */
export function wholeDayIn(day: number, range: TimeRange): boolean {
  return day >= range.from && day + DAY_MS <= range.to;
}

/** A range a whole number of days long: shifting a day by it lands on a whole day. */
export function alignedByDays(range: TimeRange): boolean {
  return (range.to - range.from) % DAY_MS === 0;
}
