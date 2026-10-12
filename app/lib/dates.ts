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

const clocks = new Map<string, Intl.DateTimeFormat>();

/** How far `timeZone`'s clock is ahead of UTC at `instant`, in milliseconds. */
function offsetAt(instant: number, timeZone: string): number {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    clocks.set(timeZone, clock);
  }
  const parts = Object.fromEntries(clock.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return wall - (instant - (instant % 1000));
}

/** The moment the clock in `timeZone` reads `minutes` past midnight on `date`. */
export function localInstant(date: string, minutes: number, timeZone: string): number {
  const wall = toUtcMidnight(date) + minutes * 60_000;
  // Twice: the offset at the guess can differ from the offset at the answer across a DST change.
  return wall - offsetAt(wall - offsetAt(wall, timeZone), timeZone);
}

/** The first moment after `now` when the clock in `timeZone` reads `hour`:00. */
export function nextLocalHour(timeZone: string, hour: number, now: number): number {
  let date = localDate(new Date(now), timeZone);
  for (;;) {
    const at = localInstant(date, hour * 60, timeZone);
    if (at > now) return at;
    date = addDays(date, 1);
  }
}

/**
 * The UTC midnight that falls on `date` in `timeZone`: a slop out then gets
 * the whole of a slop of the day race and still counts for that local day.
 * A day shortened by a clock change can miss every UTC midnight (the Azores
 * in spring); it starts at its first whole hour instead, since its midnight
 * may be the hour the clocks skipped.
 */
export function raceStartOn(date: string, timeZone: string): number {
  for (const offset of [-1, 0, 1]) {
    const midnight = toUtcMidnight(addDays(date, offset));
    if (localDate(new Date(midnight), timeZone) === date) return midnight;
  }
  for (let hour = 0; ; hour++) {
    const at = localInstant(date, hour * 60, timeZone);
    if (localDate(new Date(at), timeZone) === date) return at;
  }
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

/** "8 October 2026" style label for a calendar date. */
export function formatDate(date: string): string {
  return new Date(toUtcMidnight(date)).toLocaleDateString("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
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
