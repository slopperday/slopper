import { data, Form, Link } from "react-router";
import type { Route } from "./+types/goal";
import { api } from "@convex/_generated/api";
import { absoluteUrl } from "~/.server/config";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { formText, parseGoalForm } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { utcDate } from "~/lib/dates";
import { goalShareText } from "~/lib/goal";
import { seo } from "~/lib/seo";
import { GoalGrid } from "~/components/GoalGrid";
import { GoalSetup } from "~/components/GoalSetup";
import { GoalShare } from "~/components/GoalShare";
import { AgentPrompt } from "~/components/AgentPrompt";
import { goalPrompt } from "~/lib/prompts";

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const today = utcDate(Date.now());
  const profile = await convex.query(api.users.profile, { username: user.username, asUser: user._id });
  // Only a running goal shows here; finished ones live on the profile.
  const progress = profile?.progress && profile.progress.status !== "ended" ? profile.progress : null;
  return {
    today,
    timeZone: user.timeZone,
    username: user.username,
    progress,
    firstGoal: !profile?.progress && (profile?.pastGoals.length ?? 0) === 0,
    streak: profile?.streak ?? 0,
    share: progress ? { text: goalShareText(progress.goal), url: absoluteUrl(`/@${user.username}`) } : null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const today = utcDate(Date.now());
  const form = await request.formData();

  if (formText(form, "intent") === "abandon") {
    const goal = await convex.query(api.goals.open, { userId: user._id, today });
    if (goal) await convex.mutation(api.goals.abandon, { userId: user._id, goalId: goal._id });
    return redirectWithFlash("/goal", { tone: "info", message: "Goal dropped." });
  }

  const parsed = parseGoalForm(form, today);
  if (!parsed.ok) return data({ errors: parsed.errors }, { status: 422 });
  const result = await convex.mutation(api.goals.create, { userId: user._id, today, ...parsed.value });
  if (!result.ok) return redirectWithFlash("/goal", { tone: "error", message: result.error });
  // Back here, where a fresh goal opens on sharing it.
  return redirectWithFlash("/goal", { tone: "success", message: `Goal set: ${result.goal.title}.` });
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Your goal", noindex: true });

export default function GoalPage({ loaderData, actionData }: Route.ComponentProps) {
  const { progress, share, today } = loaderData;
  const errors: Record<string, string> = actionData?.errors ?? {};

  if (!progress || !share) {
    return (
      <section className="mx-auto max-w-4xl px-4 pt-14 pb-10">
        <h1 className="title-1">{loaderData.firstGoal ? "First, a goal." : "Set a goal"}</h1>
        <p className="lede mt-4">Pick the days, then the pace. Every day you ship flips a tile.</p>
        <GoalSetup today={today} timeZone={loaderData.timeZone} errors={errors} />
        <div className="mt-16">
          <AgentPrompt prompt={goalPrompt} />
        </div>
      </section>
    );
  }

  // Until the first slop is out, sharing is the next step; after that it's a footnote.
  const fresh = progress.shipped === 0 && (progress.status === "upcoming" || progress.status === "active");
  return (
    <section className="mx-auto max-w-4xl px-4 pt-14">
      <h1 className="title-1">Your goal</h1>
      <p className="lede mt-4">Every day you ship flips a tile. Miss one and the dot stays.</p>
      <div className="mt-10 grid gap-8">
        {fresh && <GoalShare text={share.text} url={share.url} fresh />}
        <GoalGrid progress={progress} username={loaderData.username} streak={loaderData.streak} />
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link to="/new" className="btn btn-slop btn-lg">
            Throw today's slop
          </Link>
          <details>
            <summary className="flex min-h-11 items-center text-muted underline hover:text-ink">Drop this goal</summary>
            <Form method="post" className="mt-2">
              <input type="hidden" name="intent" value="abandon" />
              <button type="submit" className="btn btn-sm">
                Yes, drop it
              </button>
            </Form>
          </details>
        </div>
        {!fresh && <GoalShare text={share.text} url={share.url} fresh={false} />}
      </div>
    </section>
  );
}
