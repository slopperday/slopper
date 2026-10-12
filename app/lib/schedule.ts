import { addDays, isIsoDate, localDate, localInstant, raceStartOn } from "./dates";
import { LIMITS } from "./model";

/**
 * Scheduled launches. A slop that's ready can wait in its maker's queue and
 * go live later: at a time they pick, or on their next free day. It counts
 * towards the goal on the day it goes live, like any launch, so three out on
 * one day are three slops and three queued for three days fill three days.
 */

/** When to put a launch out: now, the next free day, or a chosen moment. */
export type ReleaseWhen = { kind: "now" } | { kind: "next" } | { kind: "at"; at: number };

/**
 * The next day, from today on, with nothing out or queued, at the start of
 * its slop of the day race (the UTC midnight that falls on it), so the slop
 * gets all 24 hours of votes. `taken` holds local dates.
 */
export function nextFreeRelease(taken: ReadonlySet<string>, today: string, timeZone: string, now: number): number {
  for (let date = today; ; date = addDays(date, 1)) {
    if (taken.has(date)) continue;
    const at = raceStartOn(date, timeZone);
    if (at > now) return at;
  }
}

const LOCAL_DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const ZONED_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Reads a release time: "now", "next" (the next free day), an ISO 8601
 * date-time with an offset, or one without (a form's datetime-local, or an
 * agent's wall time), which is read in the owner's time zone. Null when it's
 * none of those.
 */
export function parseRelease(value: string, timeZone: string): ReleaseWhen | null {
  const text = value.trim();
  if (text === "now") return { kind: "now" };
  if (text === "next") return { kind: "next" };
  const local = LOCAL_DATE_TIME.exec(text);
  if (local) {
    const [, date, hours, minutes] = local;
    if (!isIsoDate(date) || +hours > 23 || +minutes > 59) return null;
    return { kind: "at", at: localInstant(date, +hours * 60 + +minutes, timeZone) };
  }
  if (!ZONED_DATE_TIME.test(text)) return null;
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : { kind: "at", at };
}

/** Why a release time won't do, or null when it will. */
export function releaseProblem(at: number, now: number): string | null {
  if (at <= now) return "Pick a time that hasn't happened yet.";
  if (at > now + LIMITS.scheduleDays * 86_400_000) return `Pick a time in the next ${LIMITS.scheduleDays} days.`;
  return null;
}

const releaseFormats = new Map<string, Intl.DateTimeFormat>();

/** "Thu 15 Oct, 17:00" in the owner's time zone. */
export function formatRelease(at: number, timeZone: string): string {
  let format = releaseFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-GB", {
      timeZone,
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    releaseFormats.set(timeZone, format);
  }
  return format.format(at);
}

/** An instant as a datetime-local value ("2026-10-15T17:00") in `timeZone`. */
export function localDateTimeValue(at: number, timeZone: string): string {
  const date = localDate(new Date(at), timeZone);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return `${date}T${clock.format(at)}`;
}
