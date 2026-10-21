import { addDays, dayStart, formatClock, formatDay, localDate } from "./dates";

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
  /** The UTC date it went out (`slops.launchDate`). */
  launchDate: string;
}

/**
 * When editing closes: 12 hours after launch or the end of the launch day,
 * whichever is later. A launch early in the (UTC) day stays open until
 * midnight UTC; a late one gets its full 12 hours into the next day.
 */
export function editableUntil(slop: Launched): number {
  const endOfLaunchDay = dayStart(addDays(slop.launchDate, 1));
  return Math.max(slop.launchedAt + EDIT_WINDOW_MS, endOfLaunchDay);
}

/** What the owner is told: how long editing stays open, or that it's locked. */
export type EditWindow = { open: true; label: string } | { open: false };

/** The edit window as of `now`, labelled on the owner's clock. */
export function editWindow(slop: Launched, ownerTimeZone: string, now: number): EditWindow {
  const until = editableUntil(slop);
  return now < until ? { open: true, label: openLabel(until, now, ownerTimeZone) } : { open: false };
}

/** "Editable until midnight", "Editable until 09:30 tomorrow". */
function openLabel(until: number, now: number, timeZone: string): string {
  const clock = formatClock(until, timeZone);
  const midnight = clock === "00:00";
  // Midnight ends the day before it.
  const day = localDate(new Date(midnight ? until - 1 : until), timeZone);
  const today = localDate(new Date(now), timeZone);
  const when = day === today ? "" : day === addDays(today, 1) ? " tomorrow" : ` on ${formatDay(day)}`;
  return `Editable until ${midnight ? "midnight" : clock}${when}`;
}
