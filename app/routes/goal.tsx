import { data, Form, Link } from "react-router";
import type { Route } from "./+types/goal";
import { getKv } from "~/.server/kv";
import { requireUser, viewerContext } from "~/.server/session";
import { abandonGoal, createGoal, getOpenGoal } from "~/.server/db/goals";
import { listUserSlops } from "~/.server/db/slops";
import { formText, parseGoalForm } from "~/.server/forms";
import { slopperCard } from "~/.server/leaderboard";
import { redirectWithFlash } from "~/.server/http";
import { invalidateFeeds } from "~/.server/memo";
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
  const kv = await getKv();
  const now = new Date();
  const today = localDate(now, user.timeZone);
  const goal = await getOpenGoal(kv, user.id, today);
  return {
    today,
    timeZone: user.timeZone,
    card: goal ? slopperCard(user, await listUserSlops(kv, user.id), goal, now) : null,
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const kv = await getKv();
  const today = localDate(new Date(), user.timeZone);
  const form = await request.formData();

  if (formText(form, "intent") === "abandon") {
    const goal = await getOpenGoal(kv, user.id, today);
    if (goal) await abandonGoal(kv, user.id, goal.id);
    invalidateFeeds();
    return redirectWithFlash("/goal", { tone: "info", message: "Goal dropped. Set a new one when you're ready." });
  }

  const parsed = parseGoalForm(form, today);
  if (!parsed.ok) return data({ errors: parsed.errors }, { status: 422 });
  const result = await createGoal(kv, user.id, parsed.value, today);
  if (!result.ok) return redirectWithFlash("/goal", { tone: "error", message: result.error });
  invalidateFeeds();
  return redirectWithFlash(`/@${user.username}`, {
    tone: "success",
    message: `Goal set: ${result.goal.title}. Start throwing.`,
  });
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Your goal", noindex: true });

export default function GoalPage({ loaderData, actionData }: Route.ComponentProps) {
  const { card, today } = loaderData;
  const errors: Record<string, string> = actionData?.errors ?? {};
  return (
    <section className="mx-auto max-w-4xl px-4 py-12">
      <p className="eyebrow">Accountability</p>
      <h1 className="font-wide mt-2 text-4xl font-black sm:text-5xl">{card ? "Your goal" : "Set a goal"}</h1>

      {card?.progress ? (
        <div className="mt-8 grid gap-6">
          <GoalGrid progress={card.progress} username={card.user.username} streak={card.streak} />
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link to="/new" className="btn btn-slop">
              Throw today's slop
            </Link>
            <details>
              <summary className="cursor-pointer text-sm text-muted underline">Drop this goal</summary>
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
        <Form method="post" className="mt-8 grid gap-8">
          <AgentPrompt prompt={goalPrompt} />
          <input type="hidden" name="intent" value="create" />
          <fieldset>
            <legend className="field-label">Pick a size</legend>
            <div className="grid gap-3 sm:grid-cols-4">
              {PRESETS.map((preset, index) => (
                <label key={preset.label} className="cursor-pointer">
                  <input
                    type="radio"
                    name="preset"
                    value={`${preset.target}/${preset.days}`}
                    defaultChecked={index === 1}
                    className="peer sr-only"
                  />
                  <span className="block h-full rounded-2xl border-2 border-ink bg-card p-4 transition-transform peer-checked:-translate-y-1 peer-checked:bg-slop peer-checked:text-slop-ink peer-checked:hard-shadow peer-focus-visible:outline-2 peer-focus-visible:outline-slop">
                    <span className="font-wide block text-3xl font-black">
                      {preset.target}/{preset.days}
                    </span>
                    <span className="block font-black">{preset.label}</span>
                    <span className="block text-sm opacity-75">{preset.blurb}</span>
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
          <p className="text-sm text-muted">
            Days end at midnight in your time zone (<strong>{loaderData.timeZone}</strong>,{" "}
            <Link to="/settings" className="underline">
              change
            </Link>
            ).
          </p>
          <button type="submit" className="btn btn-slop justify-self-start text-lg">
            Set the goal
          </button>
        </Form>
      )}
    </section>
  );
}
