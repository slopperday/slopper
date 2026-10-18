import { api } from "@convex/_generated/api";
import { type FlagDefinition, type FlagState, flagState } from "@slopperday/analytics/shared/flags";
import { convex } from "./convex";
import { remembered } from "./memory";
import type { User } from "./session";

/**
 * Feature flags for whoever is rendering a page. Definitions come from
 * Convex and are kept in memory (memory.ts), so flags add no request of
 * their own to most pages; evaluating them is pure.
 */

const definitions = remembered(() => convex.query(api.analytics.flagDefinitions, {}));

/** Active flags' definitions, from memory while they're recent enough. */
export async function flagDefinitions(now: number = Date.now()): Promise<FlagDefinition[]> {
  return await definitions.get(now);
}

/** Forgets the definitions in memory, for an admin who just changed a flag. */
export function forgetFlagDefinitions(): void {
  definitions.forget();
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
