/**
 * Properties on events and people: flat maps of scalars (and lists of
 * strings), so every value fits a Convex validator and can be filtered and
 * broken down on without walking nested objects.
 */

export type PropertyValue = string | number | boolean | null | string[];

export type Properties = Record<string, PropertyValue>;

/** What one event or one person may carry. Anything past these is dropped, never stored. */
export const PROPERTY_LIMITS = {
  /** Properties per event or per `set`. */
  count: 64,
  keyLength: 64,
  /** Characters per string, and per item of a list. */
  stringLength: 1_000,
  listLength: 50,
} as const;

/**
 * Keys are identifiers: a letter first, then letters, digits and `_`.
 * Convex reserves keys starting with `$` or `_`, and plain identifiers read
 * well in filters (`utmSource`, `plan`).
 */
const KEY = /^[A-Za-z][A-Za-z0-9_]*$/;

export function isPropertyKey(key: string): boolean {
  return key.length <= PROPERTY_LIMITS.keyLength && KEY.test(key);
}

function normalizeValue(value: unknown): PropertyValue | undefined {
  if (value === null) return null;
  switch (typeof value) {
    case "string":
      return value.slice(0, PROPERTY_LIMITS.stringLength);
    case "boolean":
      return value;
    case "number":
      // NaN and Infinity aren't JSON; they'd arrive as null anyway.
      return Number.isFinite(value) ? value : undefined;
    default:
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        return value.slice(0, PROPERTY_LIMITS.listLength).map((item) => item.slice(0, PROPERTY_LIMITS.stringLength));
      }
      return undefined;
  }
}

/**
 * Keeps the properties that are valid and drops the rest: keys that aren't
 * identifiers, nested objects, mixed lists, and anything past the limits.
 * Strings and lists are cut to length rather than dropped.
 */
export function normalizeProperties(input: unknown): Properties {
  const properties: Properties = {};
  if (typeof input !== "object" || input === null || Array.isArray(input)) return properties;
  let count = 0;
  for (const [key, raw] of Object.entries(input)) {
    if (count >= PROPERTY_LIMITS.count) break;
    if (!isPropertyKey(key)) continue;
    const value = normalizeValue(raw);
    if (value === undefined) continue;
    properties[key] = value;
    count += 1;
  }
  return properties;
}

/** A string property, or null when it's missing or not a string. */
export function stringProperty(properties: Properties, key: string): string | null {
  const value = properties[key];
  return typeof value === "string" ? value : null;
}

/** A number property, or null when it's missing or not a number. */
export function numberProperty(properties: Properties, key: string): number | null {
  const value = properties[key];
  return typeof value === "number" ? value : null;
}
