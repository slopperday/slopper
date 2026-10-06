/**
 * Calendar-day math. Slopper is about *days*, and a day ends at midnight in
 * the owner's own time zone, so dates are plain `YYYY-MM-DD` strings and all
 * arithmetic happens on UTC midnights to stay clear of DST.
 */

const DAY_MS = 86_400_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** The calendar date of `instant` as seen in `timeZone`. */
export function localDate(instant: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return formatterFor(timeZone).format(instant);
}

function toUtcMidnight(date: string): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function addDays(date: string, days: number): string {
  return new Date(toUtcMidnight(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toUtcMidnight(to) - toUtcMidnight(from)) / DAY_MS);
}

export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(toUtcMidnight(value)).toISOString().startsWith(value);
}

/** "Mon 6 Oct" style label for a calendar date. */
export function formatDay(date: string): string {
  return new Date(toUtcMidnight(date)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Compact relative time: "now", "5m", "3h", "2d", then a date. */
export function timeAgo(at: string | number, now: Date = new Date()): string {
  const ms = typeof at === "number" ? at : Date.parse(at);
  const seconds = Math.max(0, (now.getTime() - ms) / 1000);
  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 7 * 86_400) return `${Math.floor(seconds / 86_400)}d`;
  return new Date(ms).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

/**
 * Current run of consecutive shipping days ending today or yesterday.
 * A streak survives until the owner's midnight, so yesterday still counts.
 */
export function currentStreak(shipDates: Iterable<string>, today: string): number {
  const shipped = new Set(shipDates);
  let cursor = shipped.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (shipped.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}
