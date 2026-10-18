import { Form, Link, redirect } from "react-router";
import type { Route } from "./+types/analytics.people";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { personName } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { EmptyState } from "~/components/Shared";

/**
 * Everyone analytics knows, most recently seen first: signed-in people by
 * username, visitors by their random id. Find someone by username or id.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const url = new URL(request.url);
  const search = url.searchParams.get("q")?.trim() ?? "";
  if (search) {
    const distinctId = await convex.query(api.analytics.findPerson, { adminId: admin._id, search });
    if (distinctId) throw redirect(`/analytics/people/${encodeURIComponent(distinctId)}`);
  }
  const cursor = url.searchParams.get("after");
  const people = await convex.query(api.analytics.people, { adminId: admin._id, cursor: cursor || null });
  return { people, search, notFound: Boolean(search) };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "People", noindex: true });

export default function People({ loaderData }: Route.ComponentProps) {
  const { people, search, notFound } = loaderData;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="People" />
      <Form method="get" role="search" className="mt-8 flex flex-wrap gap-2">
        <input
          name="q"
          defaultValue={search}
          className="input max-w-sm"
          placeholder="@username or an id"
          aria-label="Username or id"
          autoComplete="off"
        />
        <button type="submit" className="btn bg-raised">
          Find
        </button>
      </Form>
      {notFound && (
        <p role="alert" className="mt-4 text-sm">
          Nobody matches “{search}”.
        </p>
      )}
      {people.page.length === 0 ? (
        <div className="mt-8">
          <EmptyState>Nobody yet. People show up here after their first visit.</EmptyState>
        </div>
      ) : (
        <div className="mt-8 overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">People, most recently seen first</caption>
            <thead>
              <tr className="border-b border-line-strong">
                <th scope="col" className="py-2 pr-4">
                  Person
                </th>
                <th scope="col" className="py-2 pr-4">
                  Last seen
                </th>
                <th scope="col" className="py-2 pr-4">
                  First seen
                </th>
                <th scope="col" className="py-2 pr-4">
                  Came from
                </th>
                <th scope="col" className="py-2">
                  First page
                </th>
              </tr>
            </thead>
            <tbody>
              {people.page.map((person) => (
                <tr key={person._id} className="border-b border-line">
                  <td className="py-2 pr-4">
                    <Link
                      to={`/analytics/people/${encodeURIComponent(person.distinctIds[0] ?? "")}`}
                      className="link font-bold"
                    >
                      {personName(person.username, person.distinctIds)}
                    </Link>
                    {person.identified && !person.username && <span className="tag ml-2">Signed in</span>}
                  </td>
                  <td className="py-2 pr-4 whitespace-nowrap">{timeAgo(person.lastSeenAt)}</td>
                  <td className="py-2 pr-4 whitespace-nowrap">{timeAgo(person.createdAt)}</td>
                  <td className="py-2 pr-4">
                    {person.initialSource
                      ? (person.initialSource.referrerDomain ?? person.initialSource.channel)
                      : "Server only"}
                  </td>
                  <td className="py-2 font-mono text-xs">{person.initialPath ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!people.isDone && (
        <p className="mt-6">
          <Link to={`?after=${encodeURIComponent(people.continueCursor)}`} className="btn bg-raised">
            Older
          </Link>
        </p>
      )}
    </section>
  );
}
