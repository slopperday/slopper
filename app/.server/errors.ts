import { api } from "@convex/_generated/api";
import { cookieNames, describeError, errorFingerprint } from "@slopperday/analytics/shared";
import { sanitizeAnalyticsPath } from "~/lib/analytics";
import { analyticsOptedOut } from "./analytics";
import { convex } from "./convex";
import { readCookie } from "./http";

/**
 * Errors on the app server, into analytics next to the browser's (as
 * `$exception`, source "server"), so /analytics/errors has them all. The
 * visitor's analytics id ties one to their session, unless they turned
 * analytics off. Reporting never takes the page down with it: a report
 * that fails is logged.
 */
export async function reportServerError(error: unknown, request: Request): Promise<void> {
  const { type, message, stack } = describeError(error);
  try {
    await convex.mutation(api.analytics.captureServerError, {
      distinctId: analyticsOptedOut(request) ? null : (readCookie(request, cookieNames().distinctId) ?? null),
      path: sanitizeAnalyticsPath(new URL(request.url).pathname),
      type,
      message,
      stack,
      fingerprint: errorFingerprint(type, message),
    });
  } catch (reportError: unknown) {
    console.error("This error didn't reach analytics:", reportError);
  }
}
