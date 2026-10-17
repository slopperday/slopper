import { plural } from "./display";

/** The race clock: time left until midnight UTC, when today's race closes. */

const DAY_SECONDS = 86_400;

/**
 * Whole seconds until the next midnight UTC, cut short like any clock and
 * kept inside the race: 86,399 (23:59:59) just after midnight down to 1 in
 * its last second.
 */
export function secondsToUtcMidnight(now: Date): number {
  const midnight = new Date(now);
  midnight.setUTCHours(24, 0, 0, 0);
  const seconds = Math.floor((midnight.getTime() - now.getTime()) / 1000);
  return Math.min(Math.max(seconds, 1), DAY_SECONDS - 1);
}

export interface RaceClock {
  /** The board, hh:mm all day: "23:59" just after midnight down to "00:01", which the last minute reads too. */
  text: string;
  /** The board with seconds, hh:mm:ss, for a closer look. */
  textWithSeconds: string;
  /** The board in words, for screen readers: "1 hour 5 minutes". */
  spoken: string;
  /** Under an hour left: the board reads 00:mm and turns red. */
  lastHour: boolean;
}

/** How the clock shows `secondsLeft`, from {@link secondsToUtcMidnight}. */
export function raceClock(secondsLeft: number): RaceClock {
  const pad = (n: number) => String(n).padStart(2, "0");
  // The last minute still reads 00:01: the board never shows 00:00 while the race is open.
  const totalMinutes = Math.max(1, Math.floor(secondsLeft / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const words: string[] = [];
  if (hours > 0) words.push(plural(hours, "hour", "hours"));
  if (minutes > 0) words.push(plural(minutes, "minute", "minutes"));
  const exact = [Math.floor(secondsLeft / 3600), Math.floor((secondsLeft % 3600) / 60), secondsLeft % 60];
  return {
    text: `${pad(hours)}:${pad(minutes)}`,
    textWithSeconds: exact.map(pad).join(":"),
    spoken: words.join(" "),
    lastHour: secondsLeft < 3600,
  };
}
