import { importPKCS8, SignJWT } from "jose";
import { DEFAULT_SIGNUP_EVENT } from "~/lib/integrations";
import type { GoogleServiceAccount } from "../config";
import { datesBetween, fetchJson, SourceError, type SyncInput, type SyncResult } from "./source";

/**
 * Google Analytics 4, read through Slopper's service account: the maker adds
 * its email as a Viewer on their property and pastes the property id. People
 * per day are active users; signups are the property's `sign_up` events (or
 * the event the maker names); "on it now" is the realtime report's last 30
 * minutes.
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://analyticsdata.googleapis.com/v1beta";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export const GA_PROPERTY_ID = /^\d{5,14}$/;

let cached: { email: string; token: string; expires: number } | null = null;

async function accessToken(account: GoogleServiceAccount, fetcher: typeof fetch): Promise<string> {
  if (cached?.email === account.clientEmail && cached.expires > Date.now() + 60_000) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: SCOPE })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(account.clientEmail)
    .setAudience(TOKEN_URL)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(await importPKCS8(account.privateKey, "RS256"));
  const body = (await fetchJson(
    fetcher,
    TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
    },
    () => null,
  )) as { access_token: string; expires_in: number };
  cached = { email: account.clientEmail, token: body.access_token, expires: Date.now() + body.expires_in * 1000 };
  return body.access_token;
}

interface Report {
  rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
}

/** "20261009" → "2026-10-09". */
function isoDate(value: string): string {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

export async function syncGoogleAnalytics(input: SyncInput, account: GoogleServiceAccount): Promise<SyncResult> {
  const property = input.settings.propertyId ?? "";
  if (!GA_PROPERTY_ID.test(property))
    throw new SourceError("The property id is the number in Admin › Property details.");
  const event = input.settings.signupEvent || DEFAULT_SIGNUP_EVENT;
  const token = await accessToken(account, input.fetcher);
  const refused = (status: number, body: string) => {
    if (status === 403 && body.includes("PERMISSION_DENIED")) {
      return `Add ${account.clientEmail} as a Viewer on property ${property} (Admin › Property access management).`;
    }
    if (status === 404 || (status === 400 && body.includes("property"))) {
      return `Google Analytics has no property ${property}. Use the number in Admin › Property details.`;
    }
    return null;
  };
  const post = (method: string, body: unknown) =>
    fetchJson(
      input.fetcher,
      `${API}/properties/${property}:${method}`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      },
      refused,
    );

  const dateRanges = [{ startDate: input.since, endDate: "today" }];
  const [batch, realtime] = await Promise.all([
    post("batchRunReports", {
      requests: [
        { dateRanges, dimensions: [{ name: "date" }], metrics: [{ name: "activeUsers" }], limit: "1000" },
        {
          dateRanges,
          dimensions: [{ name: "date" }],
          metrics: [{ name: "eventCount" }],
          dimensionFilter: { filter: { fieldName: "eventName", stringFilter: { matchType: "EXACT", value: event } } },
          limit: "1000",
        },
        { dateRanges: [{ startDate: "29daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }] },
      ],
    }) as Promise<{ reports: [Report, Report, Report] }>,
    post("runRealtimeReport", { metrics: [{ name: "activeUsers" }] }) as Promise<Report>,
  ]);

  const byDate = (report: Report) =>
    new Map(
      (report.rows ?? []).map((row) => [isoDate(row.dimensionValues[0].value), Number(row.metricValues[0].value)]),
    );
  const people = byDate(batch.reports[0]);
  const signups = byDate(batch.reports[1]);
  // The property's days can run ahead of UTC; count up to the latest day either side has.
  const last = [input.today, ...people.keys()].sort().at(-1) ?? input.today;
  return {
    merge: "replace",
    days: datesBetween(input.since, last).map((date) => ({
      date,
      people: people.get(date) ?? 0,
      signups: signups.get(date) ?? 0,
    })),
    live: Number(realtime.rows?.[0]?.metricValues[0]?.value ?? 0),
    snapshot: { people30: Number(batch.reports[2].rows?.[0]?.metricValues[0]?.value ?? 0) },
    cursor: null,
  };
}
