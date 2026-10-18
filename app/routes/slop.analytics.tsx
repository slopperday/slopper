import { Link, useLocation } from "react-router";
import type { Route } from "./+types/slop.analytics";
import { api } from "@convex/_generated/api";
import { config } from "~/.server/config";
import { convex, convexMessage } from "~/.server/convex";
import { forbidden, notFound } from "~/.server/http";
import { requireUser, viewerContext } from "~/.server/session";
import { slopPath } from "~/lib/display";
import { clickLabel, formatChange, formatCount } from "~/lib/insights";
import { isLinkKind, LINK_KINDS } from "~/lib/model";
import { formatMoney } from "~/lib/money";
import { seo } from "~/lib/seo";
import { DaysPicker } from "~/components/analytics/AnalyticsNav";
import { BarList, ChartPanel, LineChart, Stat } from "~/components/analytics/Charts";

/**
 * A slop's own analytics, for its maker: how many people saw it, where they
 * came from, what they clicked, and what they did about it. Admins can open
 * anyone's. The maker's own visits don't count.
 */

const DAYS = [7, 30, 90] as const;

const ACTION_NAMES: Record<string, string> = {
  upvoted: "Upvotes",
  pledged: "Pledges",
  commented: "Comments",
  reviewed: "Reviews",
  "update posted": "Updates posted",
  "slop launched": "Launched",
};

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  if (!params.handle.startsWith("@")) notFound();
  const slopId = await convex.query(api.analytics.slopIdAt, { username: params.handle.slice(1), slug: params.slug });
  if (!slopId) notFound();
  const asked = Number(new URL(request.url).searchParams.get("days"));
  const days = DAYS.find((choice) => choice === asked) ?? 30;
  try {
    const answer = await convex.action(api.analytics.slopReport, { userId: user._id, slopId, days });
    return { ...answer, commentsEnabled: config.commentsEnabled };
  } catch (error) {
    if (convexMessage(error)) forbidden();
    throw error;
  }
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, { title: loaderData ? `${loaderData.slop.name}: views and clicks` : "Views and clicks", noindex: true });

export default function SlopAnalytics({ loaderData }: Route.ComponentProps) {
  const { slop, report, truncated, days, commentsEnabled } = loaderData;
  const { search } = useLocation();
  const path = slopPath(slop.username, slop.slug);
  const change = formatChange(report.totals.views, report.previous.views);
  const actions = report.actions.filter((action) => commentsEnabled || action.name !== "commented");
  return (
    <section className="mx-auto max-w-5xl px-4 pt-14">
      <p>
        <Link to={path} className="link">
          ← {slop.name}
        </Link>
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="title-1">Views and clicks</h1>
        <DaysPicker days={days} choices={DAYS} search={search} />
      </div>
      <p className="lede mt-4 max-w-2xl">
        Who saw {slop.name} in the last {days} days, where they came from and what they did. Your own visits don't
        count.
      </p>
      {truncated && (
        <p role="status" className="mt-3 text-sm text-muted">
          So much happened that this covers the start of the range only.
        </p>
      )}

      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Stat
          label="Views"
          value={formatCount(report.totals.views)}
          previous={change ? `${change} on the ${days} days before` : null}
        />
        <Stat
          label="People"
          value={formatCount(report.totals.people)}
          hint={`in ${formatCount(report.totals.sessions)} ${report.totals.sessions === 1 ? "visit" : "visits"}`}
        />
        <Stat label="Clicks and taps" value={formatCount(report.totals.interactions)} hint="on its page" />
        <Stat
          label="Upvotes"
          value={formatCount(slop.upvotes)}
          hint={
            slop.backers > 0
              ? `${formatCount(slop.backers)} ${slop.backers === 1 ? "backer" : "backers"}, ${formatMoney(slop.pledged, "USD")} pledged`
              : "No pledges yet"
          }
        />
      </div>

      <div className="mt-4">
        <ChartPanel title="Views">
          <LineChart
            title={`Views of ${slop.name}`}
            buckets={report.series.buckets}
            interval={days > 31 ? "week" : "day"}
            compareLabel={`the ${days} days before`}
            series={[
              { label: "Views", values: report.series.views, previous: report.previousSeries.views },
              { label: "People", values: report.series.people },
            ]}
          />
        </ChartPanel>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <ChartPanel title="Where they came from">
          <BarList
            rows={report.sources.map((source) => ({
              key: source.value,
              label: source.value,
              value: source.count,
              detail: `${formatCount(source.visitors)} ${source.visitors === 1 ? "person" : "people"}`,
            }))}
            empty="No visits yet."
          />
        </ChartPanel>
        <ChartPanel title="What they clicked">
          <BarList
            rows={report.clicks.map((click) => ({
              key: click.value,
              label: clickLabel(click.value, (kind) => (isLinkKind(kind) ? LINK_KINDS[kind].label : null)),
              value: click.count,
              detail: `${formatCount(click.visitors)} ${click.visitors === 1 ? "person" : "people"}`,
            }))}
            empty="Nothing clicked yet."
          />
        </ChartPanel>
        <ChartPanel title="What they did">
          <BarList
            rows={actions.map((action) => ({
              key: action.name,
              label: ACTION_NAMES[action.name] ?? action.name,
              value: action.count,
              detail: `${formatCount(action.people)} ${action.people === 1 ? "person" : "people"}`,
            }))}
            empty="No votes, pledges or updates yet."
          />
          <dl className="grid grid-cols-2 gap-2 border-t border-line pt-3 text-sm">
            <dt className="text-muted">Updates in all</dt>
            <dd className="text-right tabular-nums">{formatCount(slop.updates)}</dd>
            <dt className="text-muted">Field tests</dt>
            <dd className="text-right tabular-nums">{formatCount(slop.fieldTests)}</dd>
            {commentsEnabled && (
              <>
                <dt className="text-muted">Feedback</dt>
                <dd className="text-right tabular-nums">{formatCount(slop.comments)}</dd>
              </>
            )}
          </dl>
        </ChartPanel>
      </div>
    </section>
  );
}
