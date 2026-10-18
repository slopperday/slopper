import { Link, useLocation } from "react-router";
import type { Route } from "./+types/analytics.traffic";
import { api } from "@convex/_generated/api";
import type { WebRow } from "@slopperday/analytics/shared/insights";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import { DAY_CHOICES, formatChange, formatCount, formatDuration, formatPercent, intervalOf } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav, DaysPicker } from "~/components/analytics/AnalyticsNav";
import { BarList, ChartPanel, LineChart, Stat } from "~/components/analytics/Charts";

/**
 * The site's traffic for admins: visitors, sessions, page views, where they
 * came from and what they used, against the period before.
 */

const METRICS = { visitors: "Visitors", sessions: "Sessions", pageviews: "Page views" } as const;
const METRIC_KEYS = ["visitors", "sessions", "pageviews"] as const;
type Metric = (typeof METRIC_KEYS)[number];

function isMetric(value: string | null): value is Metric {
  return METRIC_KEYS.some((key) => key === value);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const url = new URL(request.url);
  const asked = Number(url.searchParams.get("days"));
  const days = DAY_CHOICES.find((choice) => choice === asked) ?? 30;
  const metricParam = url.searchParams.get("metric");
  const metric: Metric = isMetric(metricParam) ? metricParam : "visitors";
  const now = Date.now();
  const interval = intervalOf(url.searchParams, days);
  const query = { kind: "web" as const, range: { from: now - days * 86_400_000, to: now + 1 }, interval };
  const web = await convex.action(api.analytics.insight, { adminId: admin._id, query });
  if (web.result.kind !== "web") throw new Error("Web analytics answered with another kind of insight.");
  return {
    web: web.result,
    truncated: web.truncated,
    days,
    metric,
    interval,
  };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Traffic", noindex: true });

function rows(items: WebRow[], label: (value: string) => React.ReactNode = (value) => value) {
  return items.map((item) => ({
    key: item.value,
    label: label(item.value),
    value: item.count,
    detail: `${formatCount(item.visitors)} ${item.visitors === 1 ? "person" : "people"}`,
  }));
}

export default function Traffic({ loaderData }: Route.ComponentProps) {
  const { web, truncated, days, metric, interval } = loaderData;
  const { search } = useLocation();
  const { totals, previous } = web;
  const vs = (current: number, before: number) => {
    const change = formatChange(current, before);
    return change ? `${change} on the ${days} days before` : null;
  };
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Traffic">
        <DaysPicker days={days} choices={DAY_CHOICES} search={search} />
      </AnalyticsNav>

      <section className="mt-10" aria-labelledby="traffic-title">
        <h2 id="traffic-title" className="title-2">
          Last {days} days
        </h2>
        {truncated && (
          <p role="status" className="mt-3 text-sm text-muted">
            More happened than one insight reads: these numbers cover the start of the range.
          </p>
        )}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          <Stat
            label="Visitors"
            value={formatCount(totals.visitors)}
            previous={vs(totals.visitors, previous.visitors)}
          />
          <Stat
            label="Sessions"
            value={formatCount(totals.sessions)}
            previous={vs(totals.sessions, previous.sessions)}
          />
          <Stat
            label="Page views"
            value={formatCount(totals.pageviews)}
            previous={vs(totals.pageviews, previous.pageviews)}
          />
          <Stat
            label="Session length"
            value={formatDuration(totals.averageDurationMs)}
            previous={vs(totals.averageDurationMs, previous.averageDurationMs)}
          />
          <Stat
            label="Bounce rate"
            value={formatPercent(totals.bounceRate)}
            previous={vs(totals.bounceRate, previous.bounceRate)}
          />
        </div>
        <div className="mt-4">
          <ChartPanel
            title={METRICS[metric]}
            action={
              <div className="flex flex-wrap gap-1" role="group" aria-label="What to chart">
                {METRIC_KEYS.map((key) => {
                  const params = new URLSearchParams(search);
                  params.set("metric", key);
                  return (
                    <Link
                      key={key}
                      to={`?${params.toString()}`}
                      preventScrollReset
                      aria-current={key === metric ? "true" : undefined}
                      className={`btn btn-sm ${key === metric ? "btn-ink" : "btn-quiet"}`}
                    >
                      {METRICS[key]}
                    </Link>
                  );
                })}
              </div>
            }
          >
            <LineChart
              title={`${METRICS[metric]}, last ${days} days`}
              buckets={web.series.buckets}
              interval={interval}
              compareLabel={`the ${days} days before`}
              series={[{ label: METRICS[metric], values: web.series[metric], previous: web.previousSeries[metric] }]}
            />
          </ChartPanel>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <ChartPanel title="Pages">
            <BarList rows={rows(web.breakdowns.pages)} />
          </ChartPanel>
          <ChartPanel title="Where visits start">
            <BarList rows={rows(web.breakdowns.entryPages)} />
          </ChartPanel>
          <ChartPanel title="Channels">
            <BarList rows={rows(web.breakdowns.channels, (value) => value[0]?.toUpperCase() + value.slice(1))} />
          </ChartPanel>
          <ChartPanel title="Referring sites">
            <BarList rows={rows(web.breakdowns.referrers)} empty="No referring sites yet." />
          </ChartPanel>
          <ChartPanel title="Campaigns (utm_campaign)">
            <BarList rows={rows(web.breakdowns.utmCampaigns)} empty="No tagged links yet." />
          </ChartPanel>
          <ChartPanel title="Sources (utm_source)">
            <BarList rows={rows(web.breakdowns.utmSources)} empty="No tagged links yet." />
          </ChartPanel>
          <ChartPanel title="Where visits end">
            <BarList rows={rows(web.breakdowns.exitPages)} />
          </ChartPanel>
          <ChartPanel title="Countries">
            <BarList rows={rows(web.breakdowns.countries)} />
          </ChartPanel>
          <ChartPanel title="Browsers">
            <BarList rows={rows(web.breakdowns.browsers)} />
          </ChartPanel>
          <ChartPanel title="Operating systems">
            <BarList rows={rows(web.breakdowns.operatingSystems)} />
          </ChartPanel>
          <ChartPanel title="Devices">
            <BarList rows={rows(web.breakdowns.devices)} />
          </ChartPanel>
        </div>
      </section>
    </section>
  );
}
