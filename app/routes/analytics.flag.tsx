import { Form, Link } from "react-router";
import type { Route } from "./+types/analytics.flag";
import { api } from "@convex/_generated/api";
import { can } from "@convex/lib/permissions";
import { EVENTS } from "@slopperday/analytics/shared";
import { convex, convexMessage } from "~/.server/convex";
import { forgetFlagDefinitions } from "~/.server/flags";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { flagFormValues, flagSummary, parseFlagForm } from "~/lib/flagForm";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { FlagForm, FlagSwitch } from "~/components/analytics/FlagForm";
import { TrendsChart } from "~/components/analytics/InsightCharts";

/**
 * One flag: who gets it, how many people have seen each value lately, the
 * experiments using it, and the form to change it.
 */

const USAGE_DAYS = 14;

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const now = Date.now();
  const [found, usage] = await Promise.all([
    convex.query(api.analytics.flag, { adminId: admin._id, key: params.key }),
    convex.action(api.analytics.insight, {
      adminId: admin._id,
      query: {
        kind: "trends",
        range: { from: now - USAGE_DAYS * 86_400_000, to: now + 1 },
        interval: "day",
        series: [
          {
            event: EVENTS.flagCalled,
            math: "persons",
            filters: [{ key: "flag", operator: "equals", value: params.key }],
          },
        ],
        breakdown: "variant",
      },
    }),
  ]);
  if (!found) throw new Response("Not found", { status: 404 });
  if (usage.result.kind !== "trends") throw new Error("A trends insight answered with another kind.");
  return { ...found, usage: usage.result, canManage: can(admin, "analytics.manage") };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.manage");
  const form = await request.formData();
  const intent = formText(form, "intent");
  try {
    if (intent === "toggle") {
      const active = formText(form, "active") === "true";
      await convex.mutation(api.analytics.setFlagActive, { adminId: admin._id, key: params.key, active });
      forgetFlagDefinitions();
      return redirectWithFlash(`/analytics/flags/${params.key}`, {
        tone: "success",
        message: `It's ${active ? "on" : "off"}.`,
      });
    }
    if (intent === "delete") {
      await convex.mutation(api.analytics.removeFlag, { adminId: admin._id, key: params.key });
      forgetFlagDefinitions();
      return redirectWithFlash("/analytics/flags", { tone: "success", message: `${params.key} is deleted.` });
    }
    const fields = parseFlagForm((name) => formText(form, name));
    await convex.mutation(api.analytics.saveFlag, {
      adminId: admin._id,
      flag: { ...fields, key: params.key, active: false },
    });
    forgetFlagDefinitions();
    return redirectWithFlash(`/analytics/flags/${params.key}`, { tone: "success", message: "Saved." });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { error: message };
    throw error;
  }
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, { title: loaderData?.flag.name ?? "Flag", noindex: true });

export default function Flag({ loaderData, actionData }: Route.ComponentProps) {
  const { flag, experiments, usage, canManage } = loaderData;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title={flag.name}>
        {canManage ? (
          <FlagSwitch flagKey={flag.key} active={flag.active} />
        ) : (
          <span className="tag">{flag.active ? "On" : "Off"}</span>
        )}
      </AnalyticsNav>
      <p className="mt-6 font-mono">{flag.key}</p>
      {flag.description && <p className="lede mt-2 max-w-2xl">{flag.description}</p>}
      <p className="mt-2 text-sm text-muted">
        {flagSummary(flag)} · changed {timeAgo(flag.updatedAt)}
      </p>
      {actionData?.error && (
        <p role="alert" className="mt-6 rounded-xl bg-hot px-4 py-3 font-bold text-hot-ink">
          {actionData.error}
        </p>
      )}

      <div className="mt-10">
        <TrendsChart result={usage} interval="day" title={`People who saw it, last ${USAGE_DAYS} days`} />
      </div>

      <section aria-labelledby="experiments-title" className="mt-12">
        <h2 id="experiments-title" className="title-2">
          Experiments
        </h2>
        {experiments.length === 0 ? (
          <p className="mt-3 text-muted">
            None use it.{" "}
            {flag.variants && (
              <Link to={`/analytics/experiments?flag=${flag.key}`} className="link">
                Set one up
              </Link>
            )}
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {experiments.map((experiment) => (
              <li key={experiment._id}>
                <Link to={`/analytics/experiments/${experiment.key}`} className="link font-bold">
                  {experiment.name}
                </Link>{" "}
                <span className="tag">{experiment.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage && (
        <>
          <FlagForm values={flagFormValues(flag)} editing />
          <Form method="post" className="mt-6">
            <button type="submit" name="intent" value="delete" className="btn btn-quiet">
              Delete the flag
            </button>
          </Form>
        </>
      )}
    </section>
  );
}
