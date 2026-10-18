import { Form, Link } from "react-router";
import type { Route } from "./+types/analytics.person";
import { api } from "@convex/_generated/api";
import { can } from "@convex/lib/permissions";
import { convex } from "~/.server/convex";
import { redirectWithFlash } from "~/.server/http";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { formatDuration, personName } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { EventList } from "~/components/analytics/EventList";

/**
 * One person in analytics: who they are, where they first came from, their
 * sessions and what they did lately. Admins who manage analytics can delete
 * all of it, for someone who asks to be forgotten.
 */

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const viewer = context.get(viewerContext);
  const admin = requireStaff(viewer, request, "analytics.view");
  const found = await convex.query(api.analytics.person, { adminId: admin._id, distinctId: params.distinctId });
  if (!found) throw new Response("Not found", { status: 404 });
  return { ...found, distinctId: params.distinctId, canForget: can(admin, "analytics.manage") };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.manage");
  const forgotten = await convex.mutation(api.analytics.forget, { adminId: admin._id, distinctId: params.distinctId });
  return redirectWithFlash("/analytics/people", {
    tone: forgotten ? "success" : "error",
    message: forgotten ? "Forgotten. Everything analytics had on them is being deleted." : "Nobody to forget.",
  });
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Person", noindex: true });

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1">{children}</dd>
    </div>
  );
}

export default function Person({ loaderData }: Route.ComponentProps) {
  const { person, username, sessions, events, recorded, canForget } = loaderData;
  const name = personName(username, person.distinctIds);
  const properties = Object.entries(person.properties);
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title={name}>
        {username && (
          <Link to={`/@${username}`} className="btn btn-sm bg-raised">
            Their profile
          </Link>
        )}
      </AnalyticsNav>

      <dl className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Fact label="First seen">{timeAgo(person.createdAt)}</Fact>
        <Fact label="Last seen">{timeAgo(person.lastSeenAt)}</Fact>
        <Fact label="First came from">
          {person.initialSource
            ? `${person.initialSource.referrerDomain ?? "Direct"} (${person.initialSource.channel})`
            : "Only seen by the server"}
        </Fact>
        <Fact label="First page">
          <span className="font-mono text-sm">{person.initialPath ?? "—"}</span>
        </Fact>
      </dl>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="sessions-title">
          <h2 id="sessions-title" className="title-2">
            Sessions
          </h2>
          {sessions.length === 0 ? (
            <p className="mt-4 text-muted">No browser sessions: everything came from the server.</p>
          ) : (
            <ul className="mt-6 divide-y divide-line border-y border-line">
              {sessions.map((session) => (
                <li key={session._id} className="flex flex-wrap items-baseline justify-between gap-3 py-3 text-sm">
                  <span>
                    <Link
                      to={`/analytics/sessions/${encodeURIComponent(session.sessionId)}`}
                      className="link font-bold"
                    >
                      {timeAgo(session.startedAt)}
                    </Link>
                    {recorded.includes(session.sessionId) && <span className="tag ml-2">Recorded</span>}
                  </span>
                  <span>
                    {session.pageviews} {session.pageviews === 1 ? "page" : "pages"},{" "}
                    {formatDuration(session.endedAt - session.startedAt)}
                  </span>
                  <span className="text-muted">
                    {session.entryPath ?? "—"} · {session.source.referrerDomain ?? session.source.channel} ·{" "}
                    {[session.device.browser, session.device.os].filter(Boolean).join(" on ")}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <h2 className="title-2 mt-12">Latest events</h2>
          <EventList events={events} />
        </section>

        <aside className="grid content-start gap-6">
          <section className="panel" aria-labelledby="ids-title">
            <h2 id="ids-title" className="font-display text-xl font-extrabold">
              Ids
            </h2>
            <ul className="mt-3 grid gap-1 font-mono text-xs break-all">
              {person.distinctIds.map((id) => (
                <li key={id}>{id}</li>
              ))}
            </ul>
          </section>
          <section className="panel" aria-labelledby="properties-title">
            <h2 id="properties-title" className="font-display text-xl font-extrabold">
              Properties
            </h2>
            {properties.length === 0 ? (
              <p className="mt-3 text-sm text-muted">None set.</p>
            ) : (
              <dl className="mt-3 grid gap-2 text-sm">
                {properties.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-muted">{key}</dt>
                    <dd className="text-right break-all">{Array.isArray(value) ? value.join(", ") : String(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
          {canForget && (
            <details className="panel">
              <summary className="cursor-pointer font-bold">Forget this person</summary>
              <p className="mt-3 text-sm text-muted">
                Deletes every event, session and property analytics has on them. Their account, if they have one, stays.
              </p>
              <Form method="post" className="mt-4">
                <button type="submit" className="btn btn-sm bg-hot text-hot-ink">
                  Yes, forget them
                </button>
              </Form>
            </details>
          )}
        </aside>
      </div>
    </section>
  );
}
