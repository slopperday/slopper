import { Link } from "react-router";
import type { Route } from "./+types/analytics.flags";
import { api } from "@convex/_generated/api";
import { can } from "@convex/lib/permissions";
import { convex, convexMessage } from "~/.server/convex";
import { forgetFlagDefinitions } from "~/.server/flags";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { flagSummary, parseFlagForm } from "~/lib/flagForm";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { FlagForm, FlagSwitch } from "~/components/analytics/FlagForm";
import { EmptyState } from "~/components/Shared";

/**
 * Feature flags, for admins: turn something on for some people, or split
 * them into variants for an experiment. Values are worked out where pages
 * render (app/.server/flags.ts) and reach code through `useFeatureFlag`.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const flags = await convex.query(api.analytics.flags, { adminId: admin._id });
  return { flags, canManage: can(admin, "analytics.manage") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.manage");
  const form = await request.formData();
  try {
    if (formText(form, "intent") === "toggle") {
      const key = formText(form, "key");
      const active = formText(form, "active") === "true";
      await convex.mutation(api.analytics.setFlagActive, { adminId: admin._id, key, active });
      forgetFlagDefinitions();
      return redirectWithFlash("/analytics/flags", { tone: "success", message: `${key} is ${active ? "on" : "off"}.` });
    }
    const fields = parseFlagForm((name) => formText(form, name));
    const { created } = await convex.mutation(api.analytics.saveFlag, {
      adminId: admin._id,
      flag: { ...fields, active: false },
    });
    forgetFlagDefinitions();
    return redirectWithFlash(`/analytics/flags/${fields.key}`, {
      tone: "success",
      message: created ? `${fields.key} is made. It's off until you turn it on.` : `${fields.key} is saved.`,
    });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { error: message };
    throw error;
  }
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Flags", noindex: true });

export default function Flags({ loaderData, actionData }: Route.ComponentProps) {
  const { flags, canManage } = loaderData;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Flags" />
      <p className="lede mt-6 max-w-2xl">
        Turn something on for some people, or split them into variants to see which works. Code reads a flag with
        useFeatureFlag, and the page already has it when it renders.
      </p>
      {actionData?.error && (
        <p role="alert" className="mt-6 rounded-xl bg-hot px-4 py-3 font-bold text-hot-ink">
          {actionData.error}
        </p>
      )}
      {flags.length === 0 ? (
        <div className="mt-8">
          <EmptyState>No flags yet.</EmptyState>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {flags.map((flag) => (
            <li key={flag._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link to={`/analytics/flags/${flag.key}`} className="link font-mono font-bold">
                  {flag.key}
                </Link>
                <span className="ml-2">{flag.name}</span>
                <p className="text-sm text-muted">
                  {flagSummary(flag)} · changed {timeAgo(flag.updatedAt)}
                </p>
              </div>
              {canManage ? (
                <FlagSwitch flagKey={flag.key} active={flag.active} />
              ) : (
                <span className="tag">{flag.active ? "On" : "Off"}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && <FlagForm />}
    </section>
  );
}
