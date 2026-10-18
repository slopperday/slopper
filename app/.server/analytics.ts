import { stringifySetCookie } from "cookie";
import { createContext, type MiddlewareFunction } from "react-router";
import { cookieNames, uuidv7 } from "@slopperday/analytics/shared";
import { config } from "./config";
import { readCookie } from "./http";

/**
 * What every page tells the analytics SDK (packages/analytics) while it
 * renders: where to send events, and what only the server knows about the
 * visitor, which is their country. And the visitor's analytics id, which
 * flags bucket them by.
 */

export interface AnalyticsSetup {
  endpoint: string;
  /** Sent with every event. */
  properties: { country?: string };
  /** Session replay; null when no sessions are recorded. */
  replay: { sampleRate: number } | null;
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
  return {
    endpoint: config.analyticsEndpoint,
    properties: country ? { country } : {},
    replay: config.analyticsReplayRate > 0 ? { sampleRate: config.analyticsReplayRate } : null,
  };
}

/** Whether this browser turned analytics off (the SDK's opt-out cookie). */
export function analyticsOptedOut(request: Request): boolean {
  return readCookie(request, cookieNames().optOut) === "1";
}

/** The visitor's analytics id, for this request: from their cookie, or made for them now. */
export const analyticsIdContext = createContext<string | null>(null);

const YEAR_SECONDS = 365 * 86_400;

/**
 * The analytics id a page renders with. A first visit gets one here, in the
 * page's response, so flags bucket the visitor the same before and after
 * the SDK arrives (it adopts the cookie). Only pages get one, not API
 * calls, and never a browser that opted out.
 */
export function analyticsIdentity(request: Request): { id: string; minted: boolean } | null {
  if (!config.analyticsEndpoint || analyticsOptedOut(request)) return null;
  const existing = readCookie(request, cookieNames().distinctId);
  if (existing) return { id: existing, minted: false };
  const page = request.method === "GET" && (request.headers.get("accept") ?? "").includes("text/html");
  return page ? { id: uuidv7(), minted: true } : null;
}

export const analyticsMiddleware: MiddlewareFunction<Response> = async ({ request, context }, next) => {
  const identity = analyticsIdentity(request);
  context.set(analyticsIdContext, identity?.id ?? null);
  const response = await next();
  if (identity?.minted) {
    // The SDK reads it, so it isn't HttpOnly; it's a random id, nothing more.
    response.headers.append(
      "set-cookie",
      stringifySetCookie({
        name: cookieNames().distinctId,
        value: identity.id,
        path: "/",
        maxAge: YEAR_SECONDS,
        sameSite: "lax",
        secure: config.appUrl.protocol === "https:",
      }),
    );
  }
  return response;
};
