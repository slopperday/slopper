import { Link } from "react-router";
import type { Route } from "./+types/analytics.recordings";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { formatDuration, personName } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { EmptyState } from "~/components/Shared";

/**
 * Session recordings, newest first: watch how people actually use Slopper.
 * Each opens on its session's page, with what happened alongside.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const cursor = new URL(request.url).searchParams.get("after");
  const recordings = await convex.query(api.analytics.recordings, { adminId: admin._id, cursor: cursor || null });
  return { recordings };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Recordings", noindex: true });

export default function Recordings({ loaderData }: Route.ComponentProps) {
  const { recordings } = loaderData;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Recordings" />
      <p className="lede mt-6 max-w-2xl">
        Visits played back as they happened. Fields are masked, private pages aren't recorded, and recordings go after
        30 days.
      </p>
      {recordings.page.length === 0 ? (
        <div className="mt-8">
          <EmptyState>No recordings yet. They show up here a few seconds into a visit.</EmptyState>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Recordings, newest first</caption>
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="py-2 pr-4">
                  When
                </th>
                <th scope="col" className="py-2 pr-4">
                  Who
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Length
                </th>
                <th scope="col" className="py-2 pr-4 text-right">
                  Pages
                </th>
                <th scope="col" className="py-2 pr-4">
                  Started on
                </th>
                <th scope="col" className="py-2">
                  Device
                </th>
              </tr>
            </thead>
            <tbody>
              {recordings.page.map(({ recording, session, username }) => (
                <tr key={recording._id} className="border-b border-line">
                  <td className="py-2 pr-4 whitespace-nowrap">
                    <Link
                      to={`/analytics/sessions/${encodeURIComponent(recording.sessionId)}#replay-title`}
                      className="link font-bold"
                    >
                      {timeAgo(recording.startedAt)}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{personName(username, [recording.distinctId])}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {formatDuration(recording.endedAt - recording.startedAt)}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{session?.pageviews ?? "—"}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{session?.entryPath ?? "—"}</td>
                  <td className="py-2">
                    {session
                      ? [session.device.deviceType, session.device.browser].filter(Boolean).join(", ") || "Unknown"
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!recordings.isDone && (
        <p className="mt-6">
          <Link to={`?after=${encodeURIComponent(recordings.continueCursor)}`} className="btn bg-raised">
            Older
          </Link>
        </p>
      )}
    </section>
  );
}
