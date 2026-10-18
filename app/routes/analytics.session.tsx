import { Link } from "react-router";
import type { Route } from "./+types/analytics.session";
import { api } from "@convex/_generated/api";
import { EVENTS } from "@slopperday/analytics/shared";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import { formatDuration, personName } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { EventList } from "~/components/analytics/EventList";
import { type ReplayMarker, ReplayPlayer } from "~/components/analytics/ReplayPlayer";

/** One visit, start to finish: where it came from, what it used, and everything that happened. */

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const found = await convex.query(api.analytics.session, { adminId: admin._id, sessionId: params.sessionId });
  if (!found) throw new Response("Not found", { status: 404 });
  return found;
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Session", noindex: true });

/** Page views and clicks as moments on the recording's timeline. */
function markersOf(events: Route.ComponentProps["loaderData"]["events"]): ReplayMarker[] {
  return events.flatMap((event): ReplayMarker[] => {
    if (event.name === EVENTS.pageview)
      return [{ at: event.timestamp, label: `Page view of ${event.path ?? "?"}`, kind: "page" }];
    if (event.name === EVENTS.rageclick) return [{ at: event.timestamp, label: "Rage click", kind: "rage" }];
    if (event.name === EVENTS.autocapture && event.properties.eventType === "click") {
      const text = event.properties.text;
      return [
        {
          at: event.timestamp,
          label: `Clicked ${typeof text === "string" ? `“${text}”` : "something"}`,
          kind: "click",
        },
      ];
    }
    return [];
  });
}

export default function Session({ loaderData }: Route.ComponentProps) {
  const { session, events, username, recording } = loaderData;
  const started = new Date(session.startedAt);
  const facts: [string, string][] = [
    ["Started", started.toLocaleString("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC"],
    ["Length", formatDuration(session.endedAt - session.startedAt)],
    ["Pages", String(session.pageviews)],
    ["Came from", `${session.source.referrerDomain ?? "Direct"} (${session.source.channel})`],
    [
      "Device",
      [session.device.browser, session.device.os, session.device.deviceType].filter(Boolean).join(", ") || "Unknown",
    ],
    ["Country", session.country ?? "Unknown"],
  ];
  return (
    <section className="mx-auto max-w-4xl px-4 pt-14">
      <AnalyticsNav title="A visit">
        <Link to={`/analytics/people/${encodeURIComponent(session.distinctId)}`} className="btn btn-sm bg-raised">
          {personName(username, [session.distinctId])}
        </Link>
      </AnalyticsNav>
      <dl className="mt-8 grid gap-6 sm:grid-cols-3">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="mt-1">{value}</dd>
          </div>
        ))}
      </dl>
      {recording && <ReplayPlayer chunks={recording.chunks} markers={markersOf(events)} />}
      <h2 className="title-2 mt-12">What happened</h2>
      <EventList events={events} since={session.startedAt} />
    </section>
  );
}
