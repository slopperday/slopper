import { cookieNames } from "@slopperday/analytics/shared";
import { config } from "./config";
import { readCookie } from "./http";

/**
 * What every page tells the analytics SDK (packages/analytics) while it
 * renders: where to send events, and what only the server knows about the
 * visitor, which is their country.
 */

export interface AnalyticsSetup {
  endpoint: string;
  /** Sent with every event. */
  properties: { country?: string };
}

/**
 * The visitor's country (ISO 3166 alpha-2) from Netlify's geolocation:
 * `x-nf-geo` is base64 JSON on function requests, and `x-country` is the
 * older header. Their IP address is never read or kept.
 */
export function countryOf(request: Request): string | null {
  const geo = request.headers.get("x-nf-geo");
  if (geo) {
    try {
      const parsed = JSON.parse(atob(geo)) as { country?: { code?: unknown } };
      const code = parsed.country?.code;
      if (typeof code === "string" && /^[A-Z]{2}$/.test(code)) return code;
    } catch {
      // Not base64 JSON: fall back to the plain header.
    }
  }
  const country = request.headers.get("x-country")?.trim().toUpperCase();
  return country && /^[A-Z]{2}$/.test(country) ? country : null;
}

/** Null when analytics is off for everyone (no endpoint configured). */
export function analyticsSetup(request: Request): AnalyticsSetup | null {
  if (!config.analyticsEndpoint) return null;
  const country = countryOf(request);
  return { endpoint: config.analyticsEndpoint, properties: country ? { country } : {} };
}

/** Whether this browser turned analytics off (the SDK's opt-out cookie). */
export function analyticsOptedOut(request: Request): boolean {
  return readCookie(request, cookieNames().optOut) === "1";
}
