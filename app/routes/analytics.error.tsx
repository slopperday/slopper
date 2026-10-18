import { Link, useLocation } from "react-router";
import type { Route } from "./+types/analytics.error";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { daysOf, errorsQuery, formatCount } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { Stat } from "~/components/analytics/Charts";

/** One issue: what was thrown, its stack, and its latest occurrences with their sessions and recordings. */

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const search = new URL(request.url).searchParams;
  const answer = await convex.action(api.analytics.insight, {
    adminId: admin._id,
    query: errorsQuery(search, Date.now(), params.fingerprint),
  });
  if (answer.result.kind !== "errors") throw new Error("An errors insight answered with another kind.");
  const [issue] = answer.result.issues;
  if (!issue) throw new Response("Not found", { status: 404 });
  const sessionIds = [
    ...new Set(answer.result.occurrences.flatMap((occurrence) => (occurrence.sessionId ? [occurrence.sessionId] : []))),
  ];
  const recorded = await convex.query(api.analytics.recordedSessions, { adminId: admin._id, sessionIds });
  return { issue, occurrences: answer.result.occurrences, recorded, days: daysOf(search) };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, {
    title: loaderData ? `${loaderData.issue.type}: ${loaderData.issue.message}` : "Error",
    noindex: true,
  });

export default function ErrorIssue({ loaderData }: Route.ComponentProps) {
  const { issue, occurrences, recorded, days } = loaderData;
  const { search } = useLocation();
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title={issue.type}>
        <Link to={`/analytics/errors${search}`} className="btn btn-sm bg-raised">
          All errors
        </Link>
      </AnalyticsNav>
      <p className="lede mt-6 max-w-3xl break-words">{issue.message}</p>
      <p className="mt-2 text-sm text-muted">
        From {issue.sources.join(", ")} · first seen {timeAgo(issue.firstSeen)} · last seen {timeAgo(issue.lastSeen)} ·
        in the last {days} days
      </p>

      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        <Stat label="Times" value={formatCount(issue.count)} />
        <Stat label="People" value={formatCount(issue.people)} />
        <Stat label="Mostly on" value={issue.paths[0]?.path ?? "—"} />
      </div>

      {issue.stack && (
        <section aria-labelledby="stack-title" className="mt-10">
          <h2 id="stack-title" className="title-2">
            Stack
          </h2>
          <pre className="mt-3 overflow-x-auto rounded-xl bg-sunk p-4 font-mono text-xs leading-relaxed">
            <code>{issue.stack}</code>
          </pre>
        </section>
      )}

      <section aria-labelledby="occurrences-title" className="mt-10">
        <h2 id="occurrences-title" className="title-2">
          Lately
        </h2>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {occurrences.map((occurrence) => (
            <li
              key={`${occurrence.timestamp}-${occurrence.sessionId}`}
              className="flex flex-wrap items-baseline justify-between gap-3 py-3 text-sm"
            >
              <span>
                <span className="font-bold">{timeAgo(occurrence.timestamp)}</span>
                <span className="ml-2 font-mono text-xs text-muted">{occurrence.path ?? "server"}</span>
                <span className="ml-2 text-muted">{occurrence.source}</span>
              </span>
              {occurrence.sessionId ? (
                <Link
                  to={`/analytics/sessions/${encodeURIComponent(occurrence.sessionId)}${recorded.includes(occurrence.sessionId) ? "#replay-title" : ""}`}
                  className="link"
                >
                  {recorded.includes(occurrence.sessionId) ? "Watch the session" : "The session"}
                </Link>
              ) : (
                <span className="text-muted">No browser session</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </section>
  );
}
