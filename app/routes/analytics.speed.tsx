import { useLocation } from "react-router";
import type { Route } from "./+types/analytics.speed";
import { api } from "@convex/_generated/api";
import type { Vital, VitalRating, VitalSummary } from "@slopperday/analytics/shared/insights";
import { convex } from "~/.server/convex";
import { requireStaff, viewerContext } from "~/.server/session";
import {
  DAY_CHOICES,
  daysOf,
  formatCount,
  formatPercent,
  formatVital,
  VITAL_LABELS,
  vitalsQuery,
} from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav, DaysPicker } from "~/components/analytics/AnalyticsNav";
import { EmptyState } from "~/components/Shared";

/**
 * How fast Slopper is for the people using it: Core Web Vitals from real
 * page loads, the 75th percentile of each as Google reads them, and per page.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const params = new URL(request.url).searchParams;
  const answer = await convex.action(api.analytics.insight, {
    adminId: admin._id,
    query: vitalsQuery(params, Date.now()),
  });
  if (answer.result.kind !== "vitals") throw new Error("A vitals insight answered with another kind.");
  return { vitals: answer.result, truncated: answer.truncated, days: daysOf(params) };
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Speed", noindex: true });

const RATINGS: Record<VitalRating, { label: string; mark: string; tone: string; bar: string }> = {
  good: { label: "Good", mark: "✓", tone: "text-slop-text", bar: "bg-slop" },
  "needs-improvement": { label: "Needs work", mark: "!", tone: "text-gold-text", bar: "bg-gold" },
  poor: { label: "Poor", mark: "✕", tone: "text-hot", bar: "bg-hot" },
};

const RATING_ORDER: readonly VitalRating[] = ["good", "needs-improvement", "poor"];
const HEADLINE: readonly Vital[] = ["lcp", "inp", "cls"];
const MORE: readonly Vital[] = ["fcp", "ttfb"];

function VitalTile({ vital, summary }: { vital: Vital; summary: VitalSummary }) {
  const rating = summary.rating ? RATINGS[summary.rating] : null;
  return (
    <section className="panel grid content-start gap-2" aria-labelledby={`vital-${vital}`}>
      <h2 id={`vital-${vital}`} className="text-sm text-muted">
        {VITAL_LABELS[vital]}
      </h2>
      <p className="font-display text-[2.25rem] leading-none font-extrabold tabular-nums">
        {summary.p75 === null ? "—" : formatVital(vital, summary.p75)}
      </p>
      {rating ? (
        <p className={`text-sm font-bold ${rating.tone}`}>
          <span aria-hidden>{rating.mark}</span> {rating.label}
        </p>
      ) : (
        <p className="text-sm text-muted">No loads measured yet</p>
      )}
      {summary.samples > 0 && (
        <>
          <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {RATING_ORDER.map((key) =>
              summary.shares[key] > 0 ? (
                <span key={key} className={RATINGS[key].bar} style={{ width: `${summary.shares[key] * 100}%` }} />
              ) : null,
            )}
          </div>
          <p className="text-xs text-muted">
            {formatPercent(summary.shares.good)} good · {formatPercent(summary.shares["needs-improvement"])} needs work
            · {formatPercent(summary.shares.poor)} poor, of {formatCount(summary.samples)}
          </p>
        </>
      )}
    </section>
  );
}

export default function Speed({ loaderData }: Route.ComponentProps) {
  const { vitals, truncated, days } = loaderData;
  const { search } = useLocation();
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Speed">
        <DaysPicker days={days} choices={DAY_CHOICES} search={search} />
      </AnalyticsNav>
      <p className="lede mt-6 max-w-2xl">
        How fast pages are for the people loading them: the 75th percentile of each of {formatCount(vitals.loads)} page{" "}
        {vitals.loads === 1 ? "load" : "loads"}, the way Google ranks them.
      </p>
      {truncated && (
        <p className="mt-2 text-sm text-muted">
          There were too many events to read them all: these numbers are partial.
        </p>
      )}
      {vitals.loads === 0 ? (
        <div className="mt-8">
          <EmptyState>No page loads measured in this range.</EmptyState>
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {HEADLINE.map((vital) => (
              <VitalTile key={vital} vital={vital} summary={vitals.vitals[vital]} />
            ))}
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {MORE.map((vital) => (
              <VitalTile key={vital} vital={vital} summary={vitals.vitals[vital]} />
            ))}
          </div>
          <section aria-labelledby="pages-title" className="mt-12">
            <h2 id="pages-title" className="title-2">
              By page
            </h2>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">Each page's 75th percentiles, most loaded first</caption>
                <thead>
                  <tr className="border-b border-line-strong">
                    <th scope="col" className="py-2 pr-4">
                      Page
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right">
                      Loads
                    </th>
                    {[...HEADLINE, ...MORE].map((vital) => (
                      <th key={vital} scope="col" className="py-2 pr-4 text-right uppercase">
                        {vital}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {vitals.pages.map((page) => (
                    <tr key={page.path} className="border-b border-line">
                      <th scope="row" className="py-2 pr-4 font-mono text-xs font-normal">
                        {page.path}
                      </th>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatCount(page.loads)}</td>
                      {[...HEADLINE, ...MORE].map((vital) => {
                        const value = page.p75[vital];
                        return (
                          <td key={vital} className="py-2 pr-4 text-right tabular-nums whitespace-nowrap">
                            {value === null ? "—" : formatVital(vital, value)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </section>
  );
}
