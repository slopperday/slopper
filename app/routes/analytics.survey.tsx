import { Form, Link } from "react-router";
import type { Route } from "./+types/analytics.survey";
import { api } from "@convex/_generated/api";
import { can } from "@convex/lib/permissions";
import { surveyScale } from "@slopperday/analytics/shared/surveys";
import { convex, convexMessage } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { requireStaff, viewerContext } from "~/.server/session";
import { forgetSurveys } from "~/.server/surveys";
import { timeAgo } from "~/lib/dates";
import { formatCount, formatPercent } from "~/lib/insights";
import { parseSurveyForm, SURVEY_KINDS, surveyFormValues } from "~/lib/surveyForm";
import { seo } from "~/lib/seo";
import { AnalyticsNav } from "~/components/analytics/AnalyticsNav";
import { BarList, ChartPanel, ColumnChart, Stat } from "~/components/analytics/Charts";
import { SurveyForm } from "~/components/analytics/SurveyForm";

/** One survey: what it asks and of whom, what people said, and starting, stopping or changing it. */

export async function loader({ request, context, params }: Route.LoaderArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.view");
  const survey = await convex.query(api.analytics.survey, { adminId: admin._id, key: params.key });
  if (!survey) throw new Response("Not found", { status: 404 });
  const answer =
    survey.startedAt === null
      ? null
      : await convex.action(api.analytics.insight, {
          adminId: admin._id,
          query: {
            kind: "survey",
            key: survey.key,
            question: survey.kind,
            range: { from: survey.startedAt, to: (survey.endedAt ?? Date.now()) + 1 },
          },
        });
  if (answer && answer.result.kind !== "survey") throw new Error("A survey insight answered with another kind.");
  return {
    survey,
    results: answer?.result.kind === "survey" ? answer.result : null,
    truncated: answer?.truncated ?? false,
    canManage: can(admin, "analytics.manage"),
  };
}

export async function action({ request, context, params }: Route.ActionArgs) {
  const admin = requireStaff(context.get(viewerContext), request, "analytics.manage");
  const form = await request.formData();
  const intent = formText(form, "intent");
  const back = `/analytics/surveys/${params.key}`;
  try {
    if (intent === "start") {
      await convex.mutation(api.analytics.startSurvey, { adminId: admin._id, key: params.key });
      forgetSurveys();
      return redirectWithFlash(back, { tone: "success", message: "Started. People are asked from now." });
    }
    if (intent === "stop") {
      await convex.mutation(api.analytics.stopSurvey, { adminId: admin._id, key: params.key });
      forgetSurveys();
      return redirectWithFlash(back, { tone: "success", message: "Stopped. Its answers stay." });
    }
    if (intent === "delete") {
      await convex.mutation(api.analytics.removeSurvey, { adminId: admin._id, key: params.key });
      forgetSurveys();
      return redirectWithFlash("/analytics/surveys", { tone: "success", message: "Deleted." });
    }
    const survey = parseSurveyForm((name) => formText(form, name));
    await convex.mutation(api.analytics.saveSurvey, { adminId: admin._id, survey: { ...survey, key: params.key } });
    return redirectWithFlash(back, { tone: "success", message: "Saved." });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return { error: message };
    throw error;
  }
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, { title: loaderData?.survey.name ?? "Survey", noindex: true });

export default function Survey({ loaderData, actionData }: Route.ComponentProps) {
  const { survey, results, truncated, canManage } = loaderData;
  const scale = surveyScale(survey.kind);
  const countOf = (value: string) => results?.answers.find((answer) => answer.value === value)?.count ?? 0;
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <AnalyticsNav title={survey.name}>
        <span className={`tag ${survey.status === "running" ? "tag-slop" : ""}`}>{survey.status}</span>
      </AnalyticsNav>
      <p className="lede mt-6 max-w-2xl">“{survey.question}”</p>
      <p className="mt-2 text-sm text-muted">
        {SURVEY_KINDS.find((kind) => kind.value === survey.kind)?.label}
        {survey.followUp && <> · then “{survey.followUp}”</>} · on pages starting with{" "}
        <span className="font-mono">{survey.target.pathPrefix}</span> ·{" "}
        {survey.target.signedIn === null ? "anyone" : survey.target.signedIn ? "people signed in" : "visitors"}, after{" "}
        {survey.target.delaySeconds}s{survey.startedAt !== null && <> · started {timeAgo(survey.startedAt)}</>}
        {survey.endedAt !== null && <> · stopped {timeAgo(survey.endedAt)}</>}
      </p>
      {actionData?.error && (
        <p role="alert" className="mt-6 rounded-xl bg-hot px-4 py-3 font-bold text-hot-ink">
          {actionData.error}
        </p>
      )}

      {results === null ? (
        <p className="mt-10 text-muted">No answers until it starts.</p>
      ) : (
        <div className="mt-8 grid gap-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat label="Asked" value={formatCount(results.shown)} />
            <Stat
              label="Answered"
              value={formatCount(results.answered)}
              hint={results.shown > 0 ? `${formatPercent(results.answered / results.shown)} of those asked` : undefined}
            />
            <Stat label="Closed it" value={formatCount(results.dismissed)} />
            {results.nps !== null ? (
              <Stat label="Net Promoter Score" value={String(results.nps)} hint="From -100 to 100" />
            ) : results.average !== null ? (
              <Stat
                label="Average"
                value={results.average.toFixed(1)}
                hint={survey.kind === "rating" ? "Out of 5" : undefined}
              />
            ) : (
              <Stat label="Written answers" value={formatCount(results.texts.length)} />
            )}
          </div>
          {truncated && (
            <p className="text-sm text-muted">There were too many events to read them all: these counts are partial.</p>
          )}
          {scale.length > 0 && (
            <ChartPanel title="Answers">
              <ColumnChart
                title={`How people answered “${survey.question}”`}
                labels={scale.map(String)}
                stacks={[{ label: "People", values: scale.map((value) => countOf(String(value))), series: 0 }]}
              />
            </ChartPanel>
          )}
          {survey.kind === "choice" && (
            <ChartPanel title="Answers">
              <BarList
                rows={survey.choices.map((choice) => ({ key: choice, label: choice, value: countOf(choice) }))}
                empty="No answers yet."
              />
            </ChartPanel>
          )}
          <ChartPanel title="In their words">
            {results.texts.length === 0 ? (
              <p className="text-sm text-muted">Nothing written yet.</p>
            ) : (
              <ul className="grid gap-2">
                {results.texts.map((text) => (
                  <li key={`${text.at}-${text.text}`} className="rounded-lg bg-raised px-3 py-2 text-sm">
                    <p className="whitespace-pre-wrap">{text.text}</p>
                    <p className="mt-1 text-xs text-muted">
                      {timeAgo(text.at)}
                      {text.sessionId && (
                        <>
                          {" · "}
                          <Link to={`/analytics/sessions/${encodeURIComponent(text.sessionId)}`} className="link">
                            their visit
                          </Link>
                        </>
                      )}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </ChartPanel>
        </div>
      )}

      {canManage && survey.status === "draft" && <SurveyForm values={surveyFormValues(survey)} editing />}
      {canManage && (
        <div className="mt-10 flex flex-wrap gap-2">
          {survey.status === "draft" && (
            <Form method="post">
              <button type="submit" name="intent" value="start" className="btn btn-slop">
                Start asking
              </button>
            </Form>
          )}
          {survey.status === "running" && (
            <Form method="post">
              <button type="submit" name="intent" value="stop" className="btn btn-ink">
                Stop asking
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
