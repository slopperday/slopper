import { Link, useLocation } from "react-router";
import type { Route } from "./+types/analytics.errors";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { DAY_CHOICES, daysOf, errorsQuery, formatCount } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav, DaysPicker } from "~/components/analytics/AnalyticsNav";
import { EmptyState } from "~/components/Shared";

/**
 * Errors, from browsers and the app server, grouped into issues: what
 * broke, how often, for how many people, and where. Each opens with its
 * stack and the sessions it happened in.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const params = new URL(request.url).searchParams;
  const answer = await convex.action(api.analytics.insight, {
    adminId: admin._id,
    query: errorsQuery(params, Date.now()),
  });
  if (answer.result.kind !== "errors") throw new Error("An errors insight answered with another kind.");
  return { errors: answer.result, truncated: answer.truncated, days: daysOf(params) };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Errors", noindex: true });

export default function Errors({ loaderData }: Route.ComponentProps) {
  const { errors, truncated, days } = loaderData;
  const { search } = useLocation();
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Errors">
        <DaysPicker days={days} choices={DAY_CHOICES} search={search} />
      </AnalyticsNav>
      <p className="lede mt-6 max-w-2xl">
        {errors.total === 0
          ? "Nothing broke in this range."
          : `${formatCount(errors.total)} ${errors.total === 1 ? "error" : "errors"} in ${formatCount(errors.issues.length)} ${errors.issues.length === 1 ? "issue" : "issues"}, from browsers and the server.`}
      </p>
      {truncated && (
        <p className="mt-2 text-sm text-muted">
          There were too many events to read them all: these counts are partial.
        </p>
      )}
      {errors.issues.length === 0 ? (
        <div className="mt-8">
          <EmptyState>No errors. Long may it last.</EmptyState>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Issues, most frequent first</caption>
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="py-2 pr-4">
                  Issue
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Times
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  People
                </th>
                <th scope="col" className="py-2 pr-4">
                  Last seen
                </th>
                <th scope="col" className="py-2">
                  Where
                </th>
              </tr>
            </thead>
            <tbody>
              {errors.issues.map((issue) => (
                <tr key={issue.fingerprint} className="border-b border-line align-top">
                  <td className="max-w-md py-2 pr-4">
                    <Link
                      to={`/analytics/errors/${issue.fingerprint}${search}`}
                      className="link block truncate font-bold"
                    >
                      {issue.type}: {issue.message}
                    </Link>
                    <span className="text-xs text-muted">
                      {issue.sources.join(", ")} · first {timeAgo(issue.firstSeen)}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatCount(issue.count)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{formatCount(issue.people)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{timeAgo(issue.lastSeen)}</td>
                  <td className="py-2 font-mono text-xs">{issue.paths.map((where) => where.path).join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
