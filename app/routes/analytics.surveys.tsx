import { Link } from "react-router";
import type { Route } from "./+types/analytics.surveys";
import { api } from "@convex/_generated/api";
import { can } from "@convex/lib/permissions";
import { convex, convexMessage } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { requireStaff, viewerContext } from "~/.server/session";
import { timeAgo } from "~/lib/dates";
import { parseSurveyForm, SURVEY_KINDS } from "~/lib/surveyForm";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { SurveyForm } from "~/components/analytics/SurveyForm";
import { EmptyState } from "~/components/Shared";

/**
 * Surveys, for admins: ask people one question on the pages you pick, and
 * read what they say. Results are on each survey's page.
 */

export async function loader({ request, context }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const surveys = await convex.query(api.analytics.surveys, { adminId: admin._id });
  return { surveys, canManage: can(admin, "analytics.manage") };
}

export async function action({ request, context }: Route.ActionArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.manage");
  const form = await request.formData();
  const survey = parseSurveyForm((name) => formText(form, name));
  try {
    const { created } = await convex.mutation(api.analytics.saveSurvey, { adminId: admin._id, survey });
    return redirectWithFlash(`/analytics/surveys/${survey.key}`, {
      tone: "success",
      message: created ? "Set up. Nobody sees it until you start it." : "Saved.",
    });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { error: message };
    throw error;
  }
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Surveys", noindex: true });

export default function Surveys({ loaderData, actionData }: Route.ComponentProps) {
  const { surveys, canManage } = loaderData;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title="Surveys" />
      <p className="lede mt-6 max-w-2xl">
        Ask one question on the pages you pick, a few seconds after people arrive. Each person is asked once, and nobody
        who turned analytics off is asked at all.
      </p>
      {actionData?.error && (
        <p role="alert" className="mt-6 rounded-xl bg-hot px-4 py-3 font-bold text-hot-ink">
          {actionData.error}
        </p>
      )}
      {surveys.length === 0 ? (
        <div className="mt-8">
          <EmptyState>No surveys yet.</EmptyState>
        </div>
      ) : (
        <ul className="mt-8 divide-y divide-line border-y border-line">
          {surveys.map((survey) => (
            <li key={survey._id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link to={`/analytics/surveys/${survey.key}`} className="link font-bold">
                  {survey.name}
                </Link>
                <p className="truncate text-sm text-muted">
                  “{survey.question}” · {SURVEY_KINDS.find((kind) => kind.value === survey.kind)?.label} · on{" "}
                  <span className="font-mono">{survey.target.pathPrefix}</span>
                  {survey.startedAt !== null && <> · started {timeAgo(survey.startedAt)}</>}
                </p>
              </div>
              <span className={`tag ${survey.status === "running" ? "tag-slop" : ""}`}>{survey.status}</span>
            </li>
          ))}
        </ul>
      )}
      {canManage && <SurveyForm />}
    </section>
  );
}
