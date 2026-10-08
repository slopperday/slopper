import { data, Form, Link } from "react-router";
import type { Route } from "./+types/goal";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { formText, parseGoalForm } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { addDays, localDate } from "~/lib/dates";
import { seo } from "~/lib/seo";
import { GoalGrid } from "~/components/GoalGrid";
import { Field } from "~/components/SlopFields";
import { AgentPrompt } from "~/components/AgentPrompt";
import { goalPrompt } from "~/lib/prompts";

const PRESETS = [
  { target: 7, days: 7, label: "Warm-up", blurb: "A week. Build the habit." },
  { target: 30, days: 30, label: "Classic", blurb: "30 slops, 30 days." },
  { target: 100, days: 100, label: "Unhinged", blurb: "100 in 100." },
  { target: 10, days: 30, label: "Slow drip", blurb: "10 in a month." },
];

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const today = localDate(new Date(), user.timeZone);
  const profile = await convex.query(api.users.profile, { username: user.username, asUser: user._id });
  return {
    today,
    timeZone: user.timeZone,
    username: user.username,
    // Only a running goal shows here; finished ones live on the profile.
    progress: profile?.progress && profile.progress.status !== "ended" ? profile.progress : null,
    streak: profile?.streak ?? 0,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const today = localDate(new Date(), user.timeZone);
  const form = await request.formData();

  if (formText(form, "intent") === "abandon") {
    const goal = await convex.query(api.goals.open, { userId: user._id, today });
    if (goal) await convex.mutation(api.goals.abandon, { userId: user._id, goalId: goal._id });
    return redirectWithFlash("/goal", { tone: "info", message: "Goal dropped. Set a new one when you're ready." });
  }

  const parsed = parseGoalForm(form, today);
  if (!parsed.ok) return data({ errors: parsed.errors }, { status: 422 });
  const result = await convex.mutation(api.goals.create, { userId: user._id, today, ...parsed.value });
  if (!result.ok) return redirectWithFlash("/goal", { tone: "error", message: result.error });
  return redirectWithFlash(`/@${user.username}`, {
    tone: "success",
    message: `Goal set: ${result.goal.title}. Start throwing.`,
  });
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Your goal", noindex: true });

export default function GoalPage({ loaderData, actionData }: Route.ComponentProps) {
  const { progress, today } = loaderData;
  const errors: Record<string, string> = actionData?.errors ?? {};
  return (
    <section className="mx-auto max-w-4xl px-4 pt-14">
      <h1 className="title-1">{progress ? "Your goal" : "Set a goal"}</h1>
      <p className="lede mt-4">
        {progress
          ? "Every day you ship flips a tile. Miss one and the dot stays."
          : "Pick a number and a deadline. Then ship every day until you hit it."}
      </p>

      {progress ? (
        <div className="mt-10 grid gap-6">
          <GoalGrid progress={progress} username={loaderData.username} streak={loaderData.streak} />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link to="/new" className="btn btn-slop btn-lg">
              Throw today's slop
            </Link>
            <details>
              <summary className="flex min-h-11 items-center text-muted underline hover:text-ink">
                Drop this goal
              </summary>
              <Form method="post" className="mt-2">
                <input type="hidden" name="intent" value="abandon" />
                <button type="submit" className="btn btn-sm">
                  Yes, drop it
                </button>
              </Form>
            </details>
          </div>
        </div>
      ) : (
        <Form method="post" className="mt-10 grid gap-10">
          <AgentPrompt prompt={goalPrompt} />
          <input type="hidden" name="intent" value="create" />
          <fieldset>
            <legend className="field-label">Pick a size</legend>
            <div className="mt-1 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PRESETS.map((preset, index) => (
                <label key={preset.label} className="cursor-pointer">
                  <input
                    type="radio"
                    name="preset"
                    value={`${preset.target}/${preset.days}`}
                    defaultChecked={index === 1}
                    className="peer sr-only"
                  />
                  <span className="block h-full rounded-2xl bg-sunk p-4 transition-colors hover:bg-line peer-checked:bg-board peer-checked:text-board-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--focus)">
                    <span className="block font-display text-[2.5rem] leading-none font-black tabular-nums">
                      {preset.target}
                      <span className="opacity-60">/{preset.days}</span>
                    </span>
                    <span className="mt-2 block font-bold">{preset.label}</span>
                    <span className="block text-[0.9375rem] opacity-75">{preset.blurb}</span>
                  </span>
                </label>
              ))}
            </div>
            <p className="field-hint">Or set your own numbers below. They win over the preset.</p>
          </fieldset>
          <div className="grid gap-6 sm:grid-cols-3">
            <Field id="target" label="Slops" error={errors.target}>
              <input id="target" name="target" type="number" min="1" max="1000" className="input" placeholder="30" />
            </Field>
            <Field id="days" label="Days" error={errors.days}>
              <input id="days" name="days" type="number" min="1" max="365" className="input" placeholder="30" />
            </Field>
            <Field id="startDate" label="Start" error={errors.startDate}>
              <input
                id="startDate"
                name="startDate"
                type="date"
                className="input"
                defaultValue={today}
                min={today}
                max={addDays(today, 30)}
              />
            </Field>
          </div>
          <Field id="title" label="Name it (optional)" error={errors.title} hint="Defaults to “30 slops in 30 days”.">
            <input id="title" name="title" className="input" maxLength={80} placeholder="Slopvember" />
          </Field>
          <p className="text-muted">
            Days end at midnight in your time zone (<strong className="text-ink">{loaderData.timeZone}</strong>,{" "}
            <Link to="/settings" className="link">
              change
            </Link>
            ).
          </p>
          <button type="submit" className="btn btn-slop btn-lg justify-self-start">
            Set the goal
          </button>
        </Form>
      )}
    </section>
  );
}
