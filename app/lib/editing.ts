import { addDays, formatDay, localDate, localDayStart } from "./dates";

/**
 * How long a launch's original post (name, tagline, description, links,
 * screenshots, category, made with) can change once it's out. After that
 * it's locked, so what people voted on stays what they saw; news goes in
 * updates, which stay open.
 */

/** The shortest edit window: 12 hours from launch. */
export const EDIT_WINDOW_MS = 12 * 3_600_000;

/** Why an edit was refused once the window has closed. */
export const EDITING_CLOSED = "Editing has closed for this slop. Post an update instead.";

export interface Launched {
  /** When it went out: the slop's creation time. */
  launchedAt: number;
  /** The owner's calendar date when it went out (`slops.launchDate`). */
  launchDate: string;
}

/**
 * When editing closes: 12 hours after launch or the end of the launch day,
 * whichever is later. A morning launch stays open until midnight; a late
 * one gets its full 12 hours into the next day.
 *
 * The launch day is `launchDate`, the owner's own date, not `raceDate` (the
 * UTC date of the slop of the day race): it's the day the slop page shows
 * and the one the maker means by "the day I launched". It ends at the
 * owner's next midnight in their current time zone, so moving zones moves
 * that end; the 12 hours never move.
 */
export function editableUntil(slop: Launched, ownerTimeZone: string): number {
  const endOfLaunchDay = localDayStart(addDays(slop.launchDate, 1), ownerTimeZone);
  return Math.max(slop.launchedAt + EDIT_WINDOW_MS, endOfLaunchDay);
}

const clocks = new Map<string, Intl.DateTimeFormat>();

function clockFor(timeZone: string): Intl.DateTimeFormat {
  let clock = clocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    clocks.set(timeZone, clock);
  }
  return clock;
}

/** What the owner is told: how long editing stays open, or that it's locked. */
export type EditWindow = { open: true; label: string } | { open: false };

/** The edit window as of `now`, labelled on the owner's clock. */
export function editWindow(slop: Launched, ownerTimeZone: string, now: number): EditWindow {
  const until = editableUntil(slop, ownerTimeZone);
  return now < until ? { open: true, label: openLabel(until, now, ownerTimeZone) } : { open: false };
}

/** "Editable until midnight", "Editable until 09:30 tomorrow". */
function openLabel(until: number, now: number, timeZone: string): string {
  const clock = clockFor(timeZone).format(until);
  const midnight = clock === "00:00";
  // Midnight ends the day before it.
  const day = localDate(new Date(midnight ? until - 1 : until), timeZone);
  const today = localDate(new Date(now), timeZone);
  const when = day === today ? "" : day === addDays(today, 1) ? " tomorrow" : ` on ${formatDay(day)}`;
  return `Editable until ${midnight ? "midnight" : clock}${when}`;
}
