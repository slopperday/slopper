import { api } from "@convex/_generated/api";
import { type FlagDefinition, type FlagState, flagState } from "@slopperday/analytics/shared/flags";
import { convex } from "./convex";
import type { User } from "./session";

/**
 * Feature flags for whoever is rendering a page. Definitions come from
 * Convex and are kept in memory: a page within half a minute of the last
 * read uses them as they are, and one within five minutes uses them while
 * they're read again in the background, so only a server's first page (or
 * its first after a long quiet spell) waits for them. Evaluating them is
 * pure, so flags add no request of their own to a page.
 */

const FRESH_MS = 30_000;
const STALE_MS = 300_000;

interface Cached {
  at: number;
  flags: Promise<FlagDefinition[]>;
}

let cache: Cached | null = null;
let refreshing: Cached | null = null;
/** Bumped when an admin changes a flag, so a read that started before it is never kept. */
let generation = 0;

function startRead(now: number): Cached {
  const started = generation;
  const next: Cached = { at: now, flags: convex.query(api.analytics.flagDefinitions, {}) };
  next.flags.then(
    () => {
      if (refreshing === next) refreshing = null;
      if (started === generation && (!cache || cache.at < next.at)) cache = next;
    },
    // A failed read isn't kept: the next page tries again.
    () => {
      if (refreshing === next) refreshing = null;
      if (cache === next) cache = null;
    },
  );
  return next;
}

/** Active flags' definitions, from memory while they're recent enough. */
export async function flagDefinitions(now: number = Date.now()): Promise<FlagDefinition[]> {
  const age = cache ? now - cache.at : Infinity;
  if (!cache || age > STALE_MS) cache = startRead(now);
  else if (age > FRESH_MS && !refreshing) refreshing = startRead(now);
  return await cache.flags;
}

/** Forgets the definitions in memory, for an admin who just changed a flag. */
export function forgetFlagDefinitions(): void {
  generation += 1;
  cache = null;
  refreshing = null;
}

/**
 * What flags can target: what the server knows about the person while it
 * renders. Signed-in people are their account; everyone has a country when
 * Netlify knows it.
 */
export function flagProperties(
  user: Pick<User, "_creationTime" | "username" | "role"> | null,
  country: string | null,
  now: number,
): Record<string, string | number | boolean> {
  return {
    signedIn: user !== null,
    ...(user
      ? {
          username: user.username,
          accountDays: Math.floor((now - user._creationTime) / 86_400_000),
          staff: user.role !== undefined,
        }
      : {}),
    ...(country ? { country } : {}),
  };
}

const NO_FLAGS: FlagState = { values: {}, payloads: {} };

/**
 * Every active flag's value for this person. Someone with no distinct id
 * (they opted out of analytics before signing in) gets every flag off.
 */
export async function flagsFor(
  distinctId: string | null,
  properties: Record<string, string | number | boolean>,
): Promise<FlagState> {
  if (!distinctId) return NO_FLAGS;
  const flags = await flagDefinitions();
  return flags.length === 0 ? NO_FLAGS : flagState(flags, distinctId, properties);
}
