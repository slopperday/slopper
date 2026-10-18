import { type Infer, v } from "convex/values";
import { bucketOf } from "./hash";
import { matchesValue } from "./filters";
import { propertyFilterValidator } from "./insights/queries";
import type { Properties } from "./properties";

/**
 * Feature flags: on or off, or one of several variants, for each person,
 * decided the same way on the server and in the browser. A person's bucket
 * comes from hashing the flag's key with their distinct id, so they keep
 * their value as a rollout grows, and two flags never move together.
 */

/** Flag keys are what code asks for: lowercase words joined by dashes. */
export const FLAG_KEY = /^[a-z][a-z0-9-]{0,63}$/;

export const flagVariantValidator = v.object({
  key: v.string(),
  /** Relative: variants weighted 1, 1 and 2 split a quarter, a quarter, a half. */
  weight: v.number(),
});

/**
 * Who gets the flag: people whose properties match every filter, a
 * percentage of them, and optionally one variant for all of them. The first
 * condition someone matches and is rolled into decides.
 */
export const flagConditionValidator = v.object({
  filters: v.array(propertyFilterValidator),
  /** 0 to 100. */
  rollout: v.number(),
  variant: v.union(v.string(), v.null()),
});

export const flagDefinitionValidator = v.object({
  key: v.string(),
  active: v.boolean(),
  /** Null for an on-or-off flag. */
  variants: v.union(v.array(flagVariantValidator), v.null()),
  conditions: v.array(flagConditionValidator),
  /** JSON per variant ("true" for an on-or-off flag), handed to code that asks. */
  payloads: v.record(v.string(), v.string()),
});

export type FlagDefinition = Infer<typeof flagDefinitionValidator>;
export type FlagCondition = Infer<typeof flagConditionValidator>;

/** What a flag is for one person: off, on, or the variant they get. */
export type FlagValue = boolean | string;

function rolledIn(flag: FlagDefinition, distinctId: string, rollout: number): boolean {
  return bucketOf(`${flag.key}.${distinctId}`) * 100 < Math.max(0, Math.min(100, rollout));
}

/** A variant by weight, from its own bucket so it doesn't move with the rollout. */
function variantFor(
  flag: FlagDefinition,
  variants: NonNullable<FlagDefinition["variants"]>,
  distinctId: string,
): string {
  const total = variants.reduce((sum, variant) => sum + Math.max(0, variant.weight), 0);
  let point = bucketOf(`${flag.key}.variant.${distinctId}`) * total;
  for (const variant of variants) {
    const weight = Math.max(0, variant.weight);
    if (point < weight) return variant.key;
    point -= weight;
  }
  return variants.at(-1)?.key ?? "";
}

export function evaluateFlag(flag: FlagDefinition, distinctId: string, properties: Properties): FlagValue {
  if (!flag.active) return false;
  for (const condition of flag.conditions) {
    if (!condition.filters.every((filter) => matchesValue(properties[filter.key], filter))) continue;
    if (!rolledIn(flag, distinctId, condition.rollout)) continue;
    const variants = flag.variants;
    if (!variants || variants.length === 0) return true;
    if (condition.variant && variants.some((variant) => variant.key === condition.variant)) return condition.variant;
    return variantFor(flag, variants, distinctId);
  }
  return false;
}

/** Every flag's value for one person, off flags included (as false). */
export function evaluateFlags(
  flags: readonly FlagDefinition[],
  distinctId: string,
  properties: Properties,
): Record<string, FlagValue> {
  return Object.fromEntries(flags.map((flag) => [flag.key, evaluateFlag(flag, distinctId, properties)]));
}

/** Flags' values and payloads for one person, as a page hands them to its code. */
export interface FlagState {
  values: Record<string, FlagValue>;
  /** Parsed JSON payloads, for flags whose value has one. */
  payloads: Record<string, unknown>;
}

/** Every flag's value for one person, with the payload each value hands code. */
export function flagState(flags: readonly FlagDefinition[], distinctId: string, properties: Properties): FlagState {
  const state: FlagState = { values: {}, payloads: {} };
  for (const flag of flags) {
    const value = evaluateFlag(flag, distinctId, properties);
    state.values[flag.key] = value;
    const payload = value === false ? undefined : flag.payloads[value === true ? "true" : value];
    // Payloads are checked as JSON when they're saved (flagProblems).
    if (payload !== undefined) {
      const parsed: unknown = JSON.parse(payload);
      state.payloads[flag.key] = parsed;
    }
  }
  return state;
}

/** Problems with a flag before it's saved; empty when there are none. */
export function flagProblems(flag: FlagDefinition): string[] {
  const problems: string[] = [];
  if (!FLAG_KEY.test(flag.key)) problems.push("A key is lowercase letters, digits and dashes, starting with a letter.");
  if (flag.conditions.length === 0) problems.push("Say who gets it: add a condition, even one for everyone.");
  for (const condition of flag.conditions) {
    if (!(condition.rollout >= 0 && condition.rollout <= 100)) problems.push("A rollout is from 0 to 100 percent.");
  }
  if (flag.variants) {
    const keys = flag.variants.map((variant) => variant.key);
    if (keys.length < 2) problems.push("A flag with variants needs two at least.");
    if (new Set(keys).size !== keys.length) problems.push("Each variant needs its own key.");
    if (keys.some((key) => !FLAG_KEY.test(key)))
      problems.push("Variant keys are lowercase letters, digits and dashes.");
    if (flag.variants.some((variant) => !(variant.weight > 0))) problems.push("Every variant needs a weight above 0.");
    for (const condition of flag.conditions) {
      if (condition.variant !== null && !keys.includes(condition.variant)) {
        problems.push(`There's no variant called “${condition.variant}”.`);
      }
    }
  } else if (flag.conditions.some((condition) => condition.variant !== null)) {
    problems.push("Only a flag with variants can pick one in a condition.");
  }
  for (const [key, payload] of Object.entries(flag.payloads)) {
    try {
      JSON.parse(payload);
    } catch {
      problems.push(`The payload for “${key}” isn't JSON.`);
    }
  }
  return problems;
}
