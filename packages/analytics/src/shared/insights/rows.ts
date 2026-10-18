import type { Properties, PropertyValue } from "../properties";
import type { DeviceType } from "../userAgent";
import type { Channel } from "../source";
import { matchesValue } from "../filters";
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

export function matchesFilter(event: EventRow, filter: PropertyFilter): boolean {
  return matchesValue(valueOf(event, filter.key), filter);
}

export function matchesAll(event: EventRow, filters: readonly PropertyFilter[] | undefined): boolean {
  return (filters ?? []).every((filter) => matchesFilter(event, filter));
}

/** A breakdown's value for an event: the property as text, or null when it has none. */
export function breakdownValue(event: EventRow, key: string): string | null {
  const value = valueOf(event, key);
  if (value === undefined || value === null) return null;
  return Array.isArray(value) ? value.join(",") : String(value);
}
