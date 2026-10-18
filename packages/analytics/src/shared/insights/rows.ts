import type { Properties, PropertyValue } from "../properties";
import type { DeviceType } from "../userAgent";
import type { Channel } from "../source";
import type { PropertyFilter } from "./queries";

/**
 * What the insights read: events and sessions as plain objects, with ids as
 * strings, so the aggregators run the same in a Convex action and a test.
 */

export interface EventRow {
  name: string;
  personId: string;
  sessionId: string | null;
  timestamp: number;
  path: string | null;
  properties: Properties;
  /** What it's about (`type:id`), when the app said. */
  group?: string | null;
}

export interface SessionRow {
  sessionId: string;
  personId: string;
  startedAt: number;
  endedAt: number;
  pageviews: number;
  interactions: number;
  entryPath: string | null;
  exitPath: string | null;
  channel: Channel;
  referrerDomain: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  browser: string | null;
  os: string | null;
  deviceType: DeviceType | null;
  country: string | null;
}

function valueOf(event: EventRow, key: string): PropertyValue | undefined {
  if (key === "path") return event.path;
  return event.properties[key];
}

function asText(value: PropertyValue): string {
  return Array.isArray(value) ? value.join(",") : String(value);
}

export function matchesFilter(event: EventRow, filter: PropertyFilter): boolean {
  const value = valueOf(event, filter.key);
  const present = value !== undefined && value !== null;
  switch (filter.operator) {
    case "isSet":
      return present;
    case "isNotSet":
      return !present;
    case "equals":
      return present && asText(value) === String(filter.value);
    case "notEquals":
      return !present || asText(value) !== String(filter.value);
    case "contains":
      return present && asText(value).toLowerCase().includes(String(filter.value).toLowerCase());
    case "notContains":
      return !present || !asText(value).toLowerCase().includes(String(filter.value).toLowerCase());
    case "greaterThan":
      return typeof value === "number" && typeof filter.value === "number" && value > filter.value;
    case "lessThan":
      return typeof value === "number" && typeof filter.value === "number" && value < filter.value;
  }
}

export function matchesAll(event: EventRow, filters: readonly PropertyFilter[] | undefined): boolean {
  return (filters ?? []).every((filter) => matchesFilter(event, filter));
}

/** A breakdown's value for an event: the property as text, or null when it has none. */
export function breakdownValue(event: EventRow, key: string): string | null {
  const value = valueOf(event, key);
  return value === undefined || value === null ? null : asText(value);
}
