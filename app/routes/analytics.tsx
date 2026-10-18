import { Link, useLocation } from "react-router";
import type { Route } from "./+types/analytics";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { slopPath } from "~/lib/display";
import { DAY_CHOICES, eventLabel, formatBucket, formatChange, formatCount, formatPercent } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav, DaysPicker } from "~/components/analytics/AnalyticsNav";
import { ChartPanel, ColumnChart, LineChart, Stat } from "~/components/analytics/Charts";
import { useLive } from "~/components/Live";

/**
 * Slopper at a glance, for admins: how many people there are and how the
 * platform is growing (accounts, launches, updates), which slops are doing
 * better than the period before, and who's here right now.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const asked = Number(new URL(request.url).searchParams.get("days"));
  const days = DAY_CHOICES.find((choice) => choice === asked) ?? 30;
  const [overview, growth, projects, live] = await Promise.all([
    convex.action(api.analytics.overview, { adminId: admin._id }),
    convex.action(api.analytics.growth, { adminId: admin._id, days }),
    convex.action(api.analytics.projects, { adminId: admin._id, days: Math.min(days, 30) }),
    convex.query(api.analytics.live, { asUser: admin._id }),
  ]);
  return { overview, growth, projects, live, days, projectDays: Math.min(days, 30) };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Analytics", noindex: true });

export default function AnalyticsOverview({ loaderData }: Route.ComponentProps) {
  const { overview, growth, projects, days, projectDays } = loaderData;
  const live = useLive(api.analytics.live, {}, loaderData.live);
  const { search } = useLocation();
  const signedUp = growth.signups.reduce((sum, count) => sum + count, 0);
  const launched = growth.launches.reduce((sum, count) => sum + count, 0);
  const labels = growth.buckets.map((bucket) => formatBucket(bucket, growth.interval));
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Analytics">
        <DaysPicker days={days} choices={DAY_CHOICES} search={search} />
      </AnalyticsNav>

      <section className="mt-10" aria-labelledby="people-title">
        <h2 id="people-title" className="title-2">
          People
        </h2>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat
            label="Slopper accounts"
            value={formatCount(growth.totals.accounts)}
            hint={`${formatCount(signedUp)} new in the last ${days} days`}
          />
          <Stat
            label="People seen"
            value={formatCount(overview.people)}
            hint={`${formatCount(overview.identified)} signed in, ${formatCount(overview.newThisWeek)} new this week`}
          />
          <Stat
            label="Active today"
            value={formatCount(overview.activeToday)}
            hint={`${formatCount(overview.activeThisWeek)} this week, ${formatCount(overview.activeThisMonth)} this month`}
          />
          <Stat
            label="Here now"
            value={formatCount(live?.here ?? 0)}
            hint={live && live.pages.length > 0 ? `Mostly on ${live.pages[0]?.path}` : "Nobody in the last 5 minutes"}
          />
        </div>
      </section>

      <section className="mt-14" aria-labelledby="growth-title">
        <h2 id="growth-title" className="title-2">
          Growth, last {days} days
        </h2>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat
            label="Slops"
            value={formatCount(growth.totals.slops)}
            hint={`${formatCount(launched)} launched lately`}
          />
          <Stat
            label="Makers who launched"
            value={formatCount(growth.totals.makers)}
            hint={`in the last ${days} days`}
          />
          <Stat
            label="Slopcessful"
            value={formatCount(growth.totals.slopcessful)}
            hint={
              growth.totals.slops > 0
                ? `${formatPercent(growth.totals.slopcessful / growth.totals.slops)} of all slops`
                : undefined
            }
          />
          <Stat
            label="Updates"
            value={formatCount(growth.updates.reduce((sum, count) => sum + count, 0))}
            hint="posted after launch"
          />
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ChartPanel title="Accounts">
            <LineChart
              title="Accounts in all"
              buckets={growth.buckets}
              interval={growth.interval}
              series={[{ label: "Accounts", values: growth.accountsAt }]}
            />
          </ChartPanel>
          <ChartPanel title={`New, per ${growth.interval}`}>
            <ColumnChart
              title="Sign-ups and launches"
              labels={labels}
              stacks={[
                { label: "Sign-ups", values: growth.signups, series: 0 },
                { label: "Launches", values: growth.launches, series: 1 },
              ]}
            />
          </ChartPanel>
        </div>
      </section>

      <section className="mt-14" aria-labelledby="projects-title">
        <h2 id="projects-title" className="title-2">
          Slops doing better
        </h2>
        <p className="mt-2 text-muted">
          Page views over the last {projectDays} days against the {projectDays} before.
        </p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Climbing" value={formatCount(projects.rising)} hint="more views than before" />
          <Stat label="New" value={formatCount(projects.new)} hint="no views before" />
          <Stat label="Fading" value={formatCount(projects.falling)} hint="fewer views than before" />
          <Stat label="Seen at all" value={formatCount(projects.active)} hint="slops with a view" />
        </div>
        {projects.rows.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <caption className="sr-only">The most viewed slops, against the period before</caption>
              <thead>
                <tr className="border-b border-line-strong">
                  <th scope="col" className="py-2 pr-4">
                    Slop
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right">
                    Views
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right">
                    People
                  </th>
                  <th scope="col" className="py-2 pr-4 text-right">
                    Change
                  </th>
                  <th scope="col" className="py-2 text-right">
                    Upvotes
                  </th>
                </tr>
              </thead>
              <tbody>
                {projects.rows.slice(0, 20).map((row) => (
                  <tr key={row.group} className="border-b border-line">
                    <td className="py-2 pr-4">
                      <Link to={`${slopPath(row.slop.username, row.slop.slug)}/analytics`} className="link font-bold">
                        {row.slop.name}
                      </Link>
                      <span className="ml-2 text-muted">@{row.slop.username}</span>
                      {row.slop.slopcessful && <span className="tag tag-gold ml-2">Slopcessful</span>}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCount(row.count)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">{formatCount(row.people)}</td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {formatChange(row.count, row.previousCount) ?? "New"}
                    </td>
                    <td className="py-2 text-right tabular-nums">{formatCount(row.slop.upvotes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-14" aria-labelledby="now-title">
        <h2 id="now-title" className="title-2">
          Happening now
        </h2>
        {live && live.events.length > 0 ? (
          <ul className="mt-6 grid gap-1 text-sm" aria-live="polite">
            {live.events.slice(0, 15).map((event) => (
              <li key={event.id} className="flex justify-between gap-3 border-b border-line py-1">
                <span className="min-w-0 truncate">
                  <span className="font-bold">{eventLabel(event.name)}</span>
                  {event.path && <span className="ml-2 font-mono text-xs text-muted">{event.path}</span>}
                </span>
                <Link to={`/analytics/people/${encodeURIComponent(event.distinctId)}`} className="link shrink-0">
                  {timeAgo(event.timestamp)}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-muted">Quiet. Nothing has happened yet.</p>
        )}
      </section>
    </section>
  );
}
