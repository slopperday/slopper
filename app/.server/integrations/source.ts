import { addDays } from "~/lib/dates";
import type { DayNumbers, SourceSnapshot } from "~/lib/integrations";

/** What every source client gets and gives back. */

export interface SyncInput {
  settings: Readonly<Record<string, string>>;
  /** The unsealed API key, for sources that have one. */
  secret: string | null;
  /** Where an incremental source left off. */
  cursor: string | null;
  /** First day to (re)count, inclusive. */
  since: string;
  /** Today, UTC. */
  today: string;
  fetcher: typeof fetch;
}

export interface SyncResult {
  /** "replace": these days were counted in full. "add": these are new numbers to add to the days. */
  merge: "replace" | "add";
  days: DayNumbers[];
  /** People on it in the last 30 minutes, for sources that know. */
  live: number | null;
  snapshot: SourceSnapshot;
  cursor: string | null;
}

/**
 * A failure the maker can fix: a refused key, a missing permission, a wrong
 * id. Its message is shown to them as is, so it says what to do.
 */
export class SourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SourceError";
  }
}

const TIMEOUT_MS = 8_000;

/**
 * Fetches JSON from a source's API. Refusals become a `SourceError` with
 * `refused`'s message; anything else unexpected throws a plain error.
 */
export async function fetchJson(
  fetcher: typeof fetch,
  url: string | URL,
  init: RequestInit,
  refused: (status: number, body: string) => string | null,
): Promise<unknown> {
  const response = await fetcher(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok) {
    const body = await response.text();
    const message = refused(response.status, body);
    if (message) throw new SourceError(message);
    throw new Error(`${new URL(url).host} answered ${response.status}: ${body.slice(0, 300)}`);
  }
  return await response.json();
}

/** Every date from `since` to `today`, inclusive. */
export function datesBetween(since: string, today: string): string[] {
  const dates: string[] = [];
  for (let date = since; date <= today; date = addDays(date, 1)) dates.push(date);
  return dates;
}

/** The UTC date of a Unix time in seconds. */
export function utcDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** Unix seconds at the start of a UTC date. */
export function unixDay(date: string): number {
  return Date.parse(`${date}T00:00:00Z`) / 1000;
}
