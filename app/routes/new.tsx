import { data, Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/new";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { requireUser, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { formText, parseSlopForm, slopFormValues } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { screenshotsWithUrls } from "~/.server/media";
import { checkSlop } from "~/.server/moderation";
import { announce, summarize } from "~/.server/social/announce";
import { goalDayFor } from "~/lib/goal";
import { localDate } from "~/lib/dates";
import { LIMITS, NETWORK_LABELS } from "~/lib/model";
import { launchTitle, slopPath } from "~/lib/display";
import { launchPrompt, relaunchPrompt } from "~/lib/prompts";
import { seo } from "~/lib/seo";
import { Field, SlopFields } from "~/components/SlopFields";
import { AgentPrompt } from "~/components/AgentPrompt";

const LAUNCH_LABEL_IDEAS = ["iOS app", "Android app", "iOS beta", "Android beta", "Desktop app", "2.0", "API"];

/** The original launch for "launch again", if it belongs to the user. */
async function relaunchSource(user: Doc<"users">, ref: string | null): Promise<Doc<"slops"> | null> {
  if (!ref) return null;
  return await convex.query(api.slops.findForServer, { userId: user._id, ref });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const today = localDate(new Date(), user.timeZone);
  const [goal, accounts, source] = await Promise.all([
    convex.query(api.goals.open, { userId: user._id, today }),
    convex.query(api.accounts.list, { userId: user._id }),
    relaunchSource(user, new URL(request.url).searchParams.get("from")),
  ]);
  const day = goal ? goalDayFor(goal, today) : null;
  return {
    goal: goal && day ? { title: goal.title, day, days: goal.days } : null,
    relaunch: source
      ? {
          id: source._id,
          name: source.name,
          values: {
            name: source.name,
            tagline: source.tagline,
            description: source.description,
            category: source.category,
            links: source.links,
            screenshots: await screenshotsWithUrls(source.screenshots),
            madeWith: source.madeWith,
          },
        }
      : null,
    autopost: accounts
      .filter((account) => account.defaultMode !== "off")
      .map((account) => ({
        id: account._id,
        network: NETWORK_LABELS[account.provider],
        handle: account.handle,
        mode: account.defaultMode,
      })),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  const parsed = parseSlopForm(form);
  const source = await relaunchSource(user, formText(form, "relaunchOf") || null);
  const label = formText(form, "launchLabel");

  const errors: Record<string, string> = parsed.ok ? {} : { ...parsed.errors };
  if (source && !label) errors.launchLabel = "Say what's launching: a platform, a version, a new app.";
  if (label.length > LIMITS.launchLabelLength) {
    errors.launchLabel = `Keep it under ${LIMITS.launchLabelLength} characters.`;
  }
  if (!parsed.ok || Object.keys(errors).length > 0) {
    const values = slopFormValues(form);
    return data(
      {
        errors,
        values: { ...values, screenshots: await screenshotsWithUrls(values.screenshots), launchLabel: label },
      },
      { status: 422 },
    );
  }

  const { launchNote, ...input } = parsed.value;
  let created: { slopId: Doc<"slops">["_id"]; updateId: Doc<"updates">["_id"]; slug: string };
  try {
    created = await convex.mutation(api.slops.create, {
      userId: user._id,
      input,
      launchNote: launchNote || input.tagline,
      today: localDate(new Date(), user.timeZone),
      ...(source ? { relaunchOf: source._id, launchLabel: label } : {}),
    });
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash("/new", { tone: "error", message });
    throw error;
  }

  const check = await checkSlop(created.slopId, launchNote);
  const title = launchTitle({ name: input.name, launchLabel: source ? label : null });
  const here = slopPath(user.username, created.slug);
  if (check?.verdict === "blocked") {
    return redirectWithFlash(here, {
      tone: "error",
      message: `${title} is held for review. A moderator will look at it.`,
    });
  }
  const autoposted =
    form.get("autopost") === "on" ? summarize(await announce(user, created.slopId, created.updateId)) : "";
  const blurred = check?.verdict === "mature" ? " It's marked NSFW, so it's blurred." : "";
  return redirectWithFlash(`${here}?new=1`, {
    tone: "success",
    message: `${title} is on the wall.${blurred}${autoposted}`,
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
    <section className="mx-auto max-w-3xl px-4 pt-14">
      <h1 className="title-1">{relaunch ? `Launch ${relaunch.name} again` : "What are you throwing today?"}</h1>
      <p className="mt-4 font-bold">
        {goal ? (
          <span className="inline-flex items-center gap-2">
            <span aria-hidden="true" className="now-pulse size-2 rounded-full bg-slop" />
            {`${goal.title} · Day ${goal.day} of ${goal.days}`}
          </span>
        ) : (
          "No goal running"
        )}
      </p>
      <p className="lede mt-2">
        {relaunch
          ? "A new platform, a new app, a 2.0: every real launch is its own slop with its own shot at slop of the day. Features belong in updates."
          : "It doesn't need to be good. It needs to be live."}
        {!goal && (
          <>
            {" "}
            <Link to="/goal" className="link text-ink">
              Set a goal
            </Link>{" "}
            so this one counts.
          </>
        )}
      </p>
      <div className="mt-10">
        <AgentPrompt prompt={relaunch ? (origin) => relaunchPrompt(origin, relaunch.name) : launchPrompt} />
      </div>
      {Object.keys(errors).length > 0 && (
        <p role="alert" className="mt-6 rounded-xl bg-hot px-4 py-3 font-bold text-hot-ink">
          A couple of things need fixing.
        </p>
      )}

      <Form method="post" className="mt-12 grid gap-8">
        {relaunch && (
          <div className="panel grid gap-2">
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

        <div className="grid gap-6 border-t border-line pt-8">
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
              <input type="checkbox" name="autopost" defaultChecked className="mt-1 size-5" />
              <span>
                <span className="font-bold">Auto-post it</span>
                <span className="block text-[0.9375rem] text-muted">
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
            <p className="text-muted">
              Want this posted to X, LinkedIn or Bluesky automatically?{" "}
              <Link to="/settings/autopost" className="link text-ink">
                Connect accounts
              </Link>
              .
            </p>
          )}
          <button type="submit" className="btn btn-slop btn-lg w-full text-[1.125rem]" disabled={submitting}>
            {submitting ? "Throwing…" : "Throw it at the wall"}
          </button>
        </div>
      </Form>
    </section>
  );
}
