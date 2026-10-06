import type { Kv } from "@deno/kv";
import { data, Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/new";
import { getKv } from "~/.server/kv";
import { requireUser, viewerContext } from "~/.server/session";
import { createSlop, getSlop, type Relaunch } from "~/.server/db/slops";
import { getOpenGoal } from "~/.server/db/goals";
import { listAccounts } from "~/.server/db/accounts";
import { ownedMediaIds } from "~/.server/db/media";
import { allowAction } from "~/.server/db/misc";
import { formText, parseSlopForm, slopFormValues } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { invalidateFeeds } from "~/.server/memo";
import { announce, summarize } from "~/.server/social/announce";
import { goalDayFor } from "~/lib/goal";
import { localDate } from "~/lib/dates";
import { LIMITS, NETWORK_LABELS, type Slop, type User } from "~/lib/model";
import { launchTitle, slopPath } from "~/lib/display";
import { launchPrompt, relaunchPrompt } from "~/lib/prompts";
import { seo } from "~/lib/seo";
import { Field, SlopFields } from "~/components/SlopFields";
import { AgentPrompt } from "~/components/AgentPrompt";

const LAUNCH_LABEL_IDEAS = ["iOS app", "Android app", "iOS beta", "Android beta", "Desktop app", "2.0", "API"];

/** The original launch for "launch again", if it belongs to the user. */
async function relaunchSource(kv: Kv, user: User, id: string | null): Promise<Slop | null> {
  if (!id) return null;
  const slop = await getSlop(kv, id);
  return slop && slop.userId === user.id ? slop : null;
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const kv = await getKv();
  const today = localDate(new Date(), user.timeZone);
  const [goal, accounts, source] = await Promise.all([
    getOpenGoal(kv, user.id, today),
    listAccounts(kv, user.id),
    relaunchSource(kv, user, new URL(request.url).searchParams.get("from")),
  ]);
  const day = goal ? goalDayFor(goal, today) : null;
  return {
    goal: goal && day ? { title: goal.title, day, days: goal.days } : null,
    relaunch: source
      ? {
          id: source.id,
          name: source.name,
          values: {
            name: source.name,
            tagline: source.tagline,
            description: source.description,
            category: source.category,
            nsfw: source.nsfw,
            links: source.links,
            screenshots: source.screenshots,
            madeWith: source.madeWith,
          },
        }
      : null,
    autopost: accounts
      .filter((account) => account.defaultMode !== "off")
      .map((account) => ({
        id: account.id,
        network: NETWORK_LABELS[account.provider],
        handle: account.handle,
        mode: account.defaultMode,
      })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const kv = await getKv();
  const form = await request.formData();
  const parsed = parseSlopForm(form);
  const source = await relaunchSource(kv, user, formText(form, "relaunchOf") || null);
  const label = formText(form, "launchLabel");

  const errors: Record<string, string> = parsed.ok ? {} : { ...parsed.errors };
  if (source && !label) errors.launchLabel = "Say what's launching: a platform, a version, a new app.";
  if (label.length > LIMITS.launchLabelLength) {
    errors.launchLabel = `Keep it under ${LIMITS.launchLabelLength} characters.`;
  }
  if (!parsed.ok || Object.keys(errors).length > 0) {
    return data({ errors, values: { ...slopFormValues(form), launchLabel: label } }, { status: 422 });
  }

  if (!(await allowAction(kv, "ship", user.id, 20, 86_400_000))) {
    return redirectWithFlash("/", { tone: "error", message: "20 slops in a day is the limit. Rest those hands." });
  }
  const { launchNote, ...input } = parsed.value;
  input.screenshots = await ownedMediaIds(kv, user.id, input.screenshots, source?.screenshots);
  const relaunch: Relaunch | null = source ? { of: source, label } : null;
  const { slop, update } = await createSlop(kv, user, input, launchNote || input.tagline, new Date(), relaunch);
  invalidateFeeds();

  const autoposted = form.get("autopost") === "on" ? summarize(await announce(kv, user, slop, update)) : "";
  return redirectWithFlash(`${slopPath(user.username, slop.slug)}?new=1`, {
    tone: "success",
    message: `${launchTitle(slop)} is on the wall.${autoposted}`,
  });
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, {
    title: loaderData?.relaunch ? `Launch ${loaderData.relaunch.name} again` : "New slop",
    noindex: true,
  });

export default function NewSlop({ loaderData, actionData }: Route.ComponentProps) {
  const { goal, autopost, relaunch } = loaderData;
  const navigation = useNavigation();
  const submitting = navigation.state === "submitting" && (navigation.formAction ?? "").startsWith("/new");
  const errors: Record<string, string> = actionData?.errors ?? {};
  const values = actionData?.values ?? relaunch?.values ?? {};
  return (
    <section className="mx-auto max-w-3xl px-4 py-12">
      <p className="eyebrow">{goal ? `${goal.title} · Day ${goal.day} of ${goal.days}` : "No goal running"}</p>
      <h1 className="font-wide mt-2 text-4xl font-black sm:text-5xl">
        {relaunch ? `Launch ${relaunch.name} again` : "What are you throwing today?"}
      </h1>
      <p className="mt-3 max-w-xl text-muted">
        {relaunch
          ? "A new platform, a new app, a 2.0: every real launch is its own slop with its own shot at slop of the day. Features belong in updates."
          : "It doesn't need to be good. It needs to be live."}
        {!goal && (
          <>
            {" "}
            <Link to="/goal" className="font-bold text-ink underline">
              Set a goal
            </Link>{" "}
            so this one counts.
          </>
        )}
      </p>
      <div className="mt-8">
        <AgentPrompt prompt={relaunch ? (origin) => relaunchPrompt(origin, relaunch.name) : launchPrompt} />
      </div>
      {Object.keys(errors).length > 0 && (
        <p
          role="alert"
          className="mt-6 rounded-xl border-2 border-ink bg-hot px-4 py-3 text-sm font-semibold text-white"
        >
          A couple of things need fixing.
        </p>
      )}

      <Form method="post" className="mt-10 grid gap-8">
        {relaunch && (
          <div className="stuck grid gap-2 p-5">
            <input type="hidden" name="relaunchOf" value={relaunch.id} />
            <Field
              id="launchLabel"
              label="What's launching?"
              error={errors.launchLabel}
              hint="A platform (iOS app, Android beta, desktop), a version (2.0), or a new app built from it."
            >
              <input
                id="launchLabel"
                name="launchLabel"
                className="input font-bold"
                required
                maxLength={LIMITS.launchLabelLength}
                placeholder="iOS app"
                defaultValue={actionData?.values.launchLabel ?? ""}
                list="launch-label-ideas"
              />
            </Field>
            <datalist id="launch-label-ideas">
              {LAUNCH_LABEL_IDEAS.map((idea) => (
                <option key={idea} value={idea} />
              ))}
            </datalist>
          </div>
        )}
        <SlopFields values={values} errors={errors} />

        <div className="stuck grid gap-5 p-5 sm:p-6">
          <Field
            id="launchNote"
            label="Launch note"
            error={errors.launchNote}
            hint="Optional. The first update, and what gets auto-posted."
          >
            <textarea
              id="launchNote"
              name="launchNote"
              className="input min-h-24"
              maxLength={LIMITS.updateLength}
              placeholder="Day 3. Tilt your phone to roll the marble. Sound on."
              defaultValue={actionData?.values.launchNote ?? ""}
            />
          </Field>
          {autopost.length > 0 ? (
            <label className="flex items-start gap-3">
              <input type="checkbox" name="autopost" defaultChecked className="mt-1 size-5 accent-[var(--slop-deep)]" />
              <span>
                <span className="font-bold">Auto-post it</span>
                <span className="block text-sm text-muted">
                  {autopost
                    .map(
                      (account) =>
                        `${account.mode === "post" ? "Post" : "Repost"} on ${account.network} as ${account.handle}`,
                    )
                    .join(" · ")}
                </span>
              </span>
            </label>
          ) : (
            <p className="text-sm text-muted">
              Want this posted to X, LinkedIn or Bluesky automatically?{" "}
              <Link to="/settings/autopost" className="font-bold text-ink underline">
                Connect accounts
              </Link>
              .
            </p>
          )}
          <button type="submit" className="btn btn-slop w-full text-lg" disabled={submitting}>
            {submitting ? "Throwing…" : "Throw it at the wall"}
          </button>
        </div>
      </Form>
    </section>
  );
}
