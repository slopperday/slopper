import { Link } from "react-router";
import type { Route } from "./+types/analytics.experiments";
import { api } from "@convex/_generated/api";
import { can } from "@convex/lib/permissions";
import { convex, convexMessage } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { eventLabel } from "~/lib/insights";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { ExperimentForm, parseExperimentForm } from "~/components/analytics/ExperimentForm";
import { EmptyState } from "~/components/Shared";

/**
 * Experiments, for admins: split people with a flag's variants and see
 * which variant gets more of them to a goal. Results are on each one's page.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const [experiments, flags, eventNames] = await Promise.all([
    convex.query(api.analytics.experiments, { adminId: admin._id }),
    convex.query(api.analytics.flags, { adminId: admin._id }),
    convex.query(api.analytics.eventNames, { adminId: admin._id }),
  ]);
  return {
    experiments,
    flags: flags.filter((flag) => (flag.variants?.length ?? 0) >= 2).map(({ key, name }) => ({ key, name })),
    eventNames,
    flag: new URL(request.url).searchParams.get("flag") ?? "",
    canManage: can(admin, "analytics.manage"),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.manage");
  const form = await request.formData();
  const experiment = parseExperimentForm((name) => formText(form, name));
  try {
    const { created } = await convex.mutation(api.analytics.saveExperiment, { adminId: admin._id, experiment });
    return redirectWithFlash(`/analytics/experiments/${experiment.key}`, {
      tone: "success",
      message: created ? "Set up. It starts when you start it." : "Saved.",
    });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { error: message };
    throw error;
  }
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Experiments", noindex: true });

export default function Experiments({ loaderData, actionData }: Route.ComponentProps) {
  const { experiments, flags, eventNames, flag, canManage } = loaderData;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Experiments" />
      <p className="lede mt-6 max-w-2xl">
        Split people with a flag's variants, pick what counts as it working, and see which variant gets more people
        there.
      </p>
      {actionData?.error && (
        <p role="alert" className="mt-6 rounded-xl bg-hot px-4 py-3 font-bold text-hot-ink">
          {actionData.error}
        </p>
      )}
      {experiments.length === 0 ? (
        <div className="mt-8">
          <EmptyState>No experiments yet.</EmptyState>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {experiments.map((experiment) => (
            <li key={experiment._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link to={`/analytics/experiments/${experiment.key}`} className="link font-bold">
                  {experiment.name}
                </Link>
                <p className="text-sm text-muted">
                  <span className="font-mono">{experiment.flagKey}</span> · goal: {eventLabel(experiment.goal.event)}
                  {experiment.startedAt !== null && <> · started {timeAgo(experiment.startedAt)}</>}
                </p>
              </div>
              <span className={`tag ${experiment.status === "running" ? "tag-slop" : ""}`}>{experiment.status}</span>
            </li>
          ))}
        </ul>
      )}
      {canManage && <ExperimentForm values={{ flagKey: flag }} flags={flags} eventNames={eventNames} />}
    </section>
  );
}
