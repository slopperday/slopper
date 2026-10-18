import { DEFAULT_SIGNUP_EVENT, POSTHOG_REGIONS } from "~/lib/integrations";
import { resolvesPublicly } from "../network";
import { datesBetween, fetchJson, SourceError, type SyncInput, type SyncResult } from "./source";

/**
 * PostHog, read with a personal API key that has Query Read. People per day
 * are distinct persons; signups are the named event; "on it now" is distinct
 * persons in the last 30 minutes. Two HogQL queries per sync.
 */

export const POSTHOG_KEY = /^phx_[A-Za-z0-9_-]{20,}$/;
export const POSTHOG_PROJECT_ID = /^\d{1,12}$/;
/** Event names go inside a HogQL string, so quotes and backslashes are never allowed. */
export const EVENT_NAME = /^[\w$ .:/-]{1,64}$/;

interface QueryResponse {
  results: unknown[][];
}

/**
 * `isPublicHost` decides whether a self-hosted address may receive the key;
 * tests pass their own so they never touch DNS.
 */
export async function syncPostHog(
  input: SyncInput,
  isPublicHost: (hostname: string) => Promise<boolean> = resolvesPublicly,
): Promise<SyncResult> {
  const { host = "", projectId = "" } = input.settings;
  const event = input.settings.signupEvent || DEFAULT_SIGNUP_EVENT;
  if (!input.secret) throw new SourceError("Paste a personal API key to connect PostHog.");
  if (!POSTHOG_PROJECT_ID.test(projectId)) throw new SourceError("The project id is the number in your PostHog URL.");
  if (!EVENT_NAME.test(event)) throw new SourceError("Event names are letters, numbers, spaces and _ $ . : / -.");
  // A self-hosted address could point anywhere; the key only goes to a public one.
  const cloud = (Object.values(POSTHOG_REGIONS) as string[]).includes(host);
  if (!cloud && !(await isPublicHost(new URL(host).hostname).catch(() => false))) {
    throw new SourceError("Self-hosted PostHog has to be on a public address Slopper can reach.");
  }

  const query = async (sql: string) =>
    (await fetchJson(
      input.fetcher,
      new URL(`/api/projects/${projectId}/query/`, host),
      {
        method: "POST",
        headers: { authorization: `Bearer ${input.secret}`, "content-type": "application/json" },
        body: JSON.stringify({ query: { kind: "HogQLQuery", query: sql }, name: "slopper-traction" }),
      },
      (status) => {
        if (status === 401) return "PostHog didn't accept that key. Make a new personal API key and paste it again.";
        if (status === 403) return "That key can't query this project. Give it the Query Read scope for the project.";
        if (status === 404) return `PostHog has no project ${projectId} on ${new URL(host).host}.`;
        return null;
      },
    )) as QueryResponse;

  const [daily, live] = await Promise.all([
    query(
      `SELECT toString(toDate(timestamp)) AS day, count(DISTINCT person_id), countIf(event = '${event}')
       FROM events WHERE timestamp >= toDateTime('${input.since} 00:00:00')
       GROUP BY day ORDER BY day LIMIT 400`,
    ),
    query(
      `SELECT uniqIf(person_id, timestamp >= now() - INTERVAL 30 MINUTE), uniq(person_id)
       FROM events WHERE timestamp >= now() - INTERVAL 30 DAY`,
    ),
  ]);

  const counts = new Map(
    daily.results.map(([day, people, signups]) => [String(day), [Number(people), Number(signups)]]),
  );
  const last = [input.today, ...counts.keys()].sort().at(-1) ?? input.today;
  return {
    merge: "replace",
    days: datesBetween(input.since, last).map((date) => {
      const [people = 0, signups = 0] = counts.get(date) ?? [];
      return { date, people, signups };
    }),
    live: Number(live.results[0]?.[0] ?? 0),
    snapshot: { people30: Number(live.results[0]?.[1] ?? 0) },
    cursor: null,
  };
}
