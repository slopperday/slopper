import { Form, Link } from "react-router";
import type { Route } from "./+types/analytics.experiment";
import { api } from "@convex/_generated/api";
import { can } from "@convex/lib/permissions";
import { convex, convexMessage } from "~/.server/convex";
import { forgetFlagDefinitions } from "~/.server/flags";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { eventLabel, formatCount, formatPercent } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { ChartPanel, seriesColor } from "~/components/analytics/Charts";
import { ExperimentForm, parseExperimentForm } from "~/components/analytics/ExperimentForm";

/**
 * One experiment: what it tests, how each variant converts with the range
 * it's likely in, and the chance each is best. Start and stop it here.
 */

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const found = await convex.action(api.analytics.experimentResults, { adminId: admin._id, key: params.key });
  if (!found) throw new Response("Not found", { status: 404 });
  const canManage = can(admin, "analytics.manage");
  // A draft can still change: its form needs the flags and events to pick from.
  const editable = canManage && found.experiment.status === "draft";
  const [flags, eventNames] = editable
    ? await Promise.all([
        convex.query(api.analytics.flags, { adminId: admin._id }),
        convex.query(api.analytics.eventNames, { adminId: admin._id }),
      ])
    : [[], []];
  return {
    ...found,
    canManage,
    flags: flags.filter((flag) => (flag.variants?.length ?? 0) >= 2).map(({ key, name }) => ({ key, name })),
    eventNames,
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.manage");
  const form = await request.formData();
  const intent = formText(form, "intent");
  const back = `/analytics/experiments/${params.key}`;
  try {
    if (intent === "start") {
      await convex.mutation(api.analytics.startExperiment, { adminId: admin._id, key: params.key });
      forgetFlagDefinitions();
      return redirectWithFlash(back, { tone: "success", message: "Started. People get variants from now." });
    }
    if (intent === "stop") {
      await convex.mutation(api.analytics.stopExperiment, { adminId: admin._id, key: params.key });
      return redirectWithFlash(back, { tone: "success", message: "Stopped. Its flag stays as it is." });
    }
    if (intent === "save") {
      const experiment = parseExperimentForm((name) => formText(form, name));
      await convex.mutation(api.analytics.saveExperiment, {
        adminId: admin._id,
        experiment: { ...experiment, key: params.key },
      });
      return redirectWithFlash(back, { tone: "success", message: "Saved." });
    }
    if (intent === "delete") {
      await convex.mutation(api.analytics.removeExperiment, { adminId: admin._id, key: params.key });
      return redirectWithFlash("/analytics/experiments", { tone: "success", message: "Deleted." });
    }
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash(back, { tone: "error", message });
    throw error;
  }
  return redirectWithFlash(back, { tone: "error", message: "That form was out of date. Try again." });
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, { title: loaderData?.experiment.name ?? "Experiment", noindex: true });

export default function Experiment({ loaderData }: Route.ComponentProps) {
  const { experiment, result, truncated, canManage, flags, eventNames } = loaderData;
  const goalPath = experiment.goal.filters.find((filter) => filter.key === "path")?.value;
  const top = Math.max(0.0001, ...(result?.variants.map((variant) => variant.interval[1]) ?? [0]));
  return (
    <section className="mx-auto max-w-5xl px-4 pt-14">
      <AnalyticsNav title={experiment.name}>
        <span className={`tag ${experiment.status === "running" ? "tag-slop" : ""}`}>{experiment.status}</span>
      </AnalyticsNav>
      <p className="lede mt-6 max-w-2xl">{experiment.hypothesis || "No hypothesis written down."}</p>
      <p className="mt-2 text-sm text-muted">
        Flag{" "}
        <Link to={`/analytics/flags/${experiment.flagKey}`} className="link font-mono">
          {experiment.flagKey}
        </Link>{" "}
        · goal: {eventLabel(experiment.goal.event)}
        {goalPath !== undefined && <> on {String(goalPath)}</>}
        {experiment.startedAt !== null && <> · started {timeAgo(experiment.startedAt)}</>}
        {experiment.endedAt !== null && <> · stopped {timeAgo(experiment.endedAt)}</>}
      </p>

      {result === null ? (
        <p className="mt-10 text-muted">No results until it starts.</p>
      ) : (
        <div className="mt-10 grid gap-4">
          <p role="status" className="panel font-bold">
            {result.winner
              ? `${result.winner} is winning: at least 95% likely to convert best.`
              : `No winner yet: each variant needs ${formatCount(result.minimumExposure)} people, and one has to be 95% likely to be best.`}
          </p>
          {truncated && (
            <p className="text-sm text-muted">There were too many events to read them all: these counts are partial.</p>
          )}
          <ChartPanel title="Conversion by variant">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <caption className="sr-only">Each variant's people, conversions and chance to win</caption>
                <thead>
                  <tr className="border-b border-line-strong">
                    <th scope="col" className="py-2 pr-4">
                      Variant
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right">
                      People
                    </th>
                    <th scope="col" className="py-2 pr-4 text-right">
                      Converted
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Rate, likely range
                    </th>
                    <th scope="col" className="py-2 text-right">
                      Chance best
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.variants.map((variant, index) => (
                    <tr key={variant.key} className="border-b border-line">
                      <th scope="row" className="py-2 pr-4 font-mono">
                        {variant.key}
                      </th>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatCount(variant.exposed)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{formatCount(variant.converted)}</td>
                      <td className="py-2 pr-4">
                        <div className="flex items-center gap-3">
                          <span className="w-14 tabular-nums">{formatPercent(variant.rate)}</span>
                          <svg viewBox="0 0 200 12" className="hidden h-3 w-full max-w-60 sm:block" aria-hidden>
                            <line
                              x1={(variant.interval[0] / top) * 200}
                              x2={(variant.interval[1] / top) * 200}
                              y1={6}
                              y2={6}
                              stroke={seriesColor(index)}
                              strokeWidth={4}
                              strokeLinecap="round"
                              opacity={0.45}
                            />
                            <circle
                              cx={(variant.rate / top) * 200}
                              cy={6}
                              r={4}
                              fill={seriesColor(index)}
                              stroke="var(--raised)"
                              strokeWidth={2}
                            />
                          </svg>
                          <span className="whitespace-nowrap text-muted tabular-nums">
                            {formatPercent(variant.interval[0])}–{formatPercent(variant.interval[1])}
                          </span>
                        </div>
                      </td>
                      <td className="py-2 text-right font-bold tabular-nums">{formatPercent(variant.chanceToWin)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </ChartPanel>
        </div>
      )}

      {canManage && experiment.status === "draft" && (
        <ExperimentForm
          values={{
            key: experiment.key,
            name: experiment.name,
            hypothesis: experiment.hypothesis,
            flagKey: experiment.flagKey,
            goalEvent: experiment.goal.event,
            goalPath: goalPath === undefined ? "" : String(goalPath),
          }}
          flags={flags}
          eventNames={eventNames}
          editing
        />
      )}

      {canManage && (
        <div className="mt-10 flex flex-wrap gap-2">
          {experiment.status === "draft" && (
            <Form method="post">
              <button type="submit" name="intent" value="start" className="btn btn-slop">
                Start it
              </button>
            </Form>
          )}
          {experiment.status === "running" && (
            <Form method="post">
              <button type="submit" name="intent" value="stop" className="btn btn-ink">
                Stop it
              </button>
            </Form>
          )}
          <Form method="post">
            <button type="submit" name="intent" value="delete" className="btn btn-quiet">
              Delete
            </button>
          </Form>
        </div>
      )}
    </section>
  );
}
