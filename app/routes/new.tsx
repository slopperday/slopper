import { useState } from "react";
import { data, Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/new";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { requireUser, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { formText, parseSlopForm, slopFormValues } from "~/.server/forms";
import { redirectWithFlash } from "~/.server/http";
import { deleteOrphanedMedia, screenshotsWithUrls } from "~/.server/media";
import { finishLaunch, launchFlash, releaseScheduled } from "~/.server/launch";
import type { User } from "~/.server/session";
import { goalDayFor } from "~/lib/goal";
import { localDate } from "~/lib/dates";
import { LIMITS, NETWORK_LABELS } from "~/lib/model";
import { launchTitle, listWords, slopPath } from "~/lib/display";
import { useAutopostNetworks } from "~/components/Shared";
import { launchPrompt, relaunchPrompt } from "~/lib/prompts";
import { formatRelease, localDateTimeValue, parseRelease, type ReleaseWhen, releaseProblem } from "~/lib/schedule";
import { seo } from "~/lib/seo";
import { Field, SlopFields } from "~/components/SlopFields";
import { AgentPrompt } from "~/components/AgentPrompt";
import { useLive } from "~/components/Live";
import { Icon } from "~/components/Icon";

const LAUNCH_LABEL_IDEAS = ["iOS app", "Android app", "iOS beta", "Android beta", "Desktop app", "2.0", "API"];

/** The original launch for "launch again", if it belongs to the user. */
async function relaunchSource(user: Doc<"users">, ref: string | null): Promise<Doc<"slops"> | null> {
  if (!ref) return null;
  return await convex.query(api.slops.findForServer, { userId: user._id, ref });
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const today = localDate(new Date(), user.timeZone);
  const [goal, accounts, source, nextFree, queue] = await Promise.all([
    convex.query(api.goals.open, { userId: user._id, today }),
    convex.query(api.accounts.list, { userId: user._id }),
    relaunchSource(user, new URL(request.url).searchParams.get("from")),
    convex.query(api.schedule.nextFree, { userId: user._id }),
    convex.query(api.schedule.mine, { asUser: user._id }),
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
    schedule: { timeZone: user.timeZone, nextFree, queue },
  };
}

/** The scheduled list's buttons: put one out now (or finish one that's out), or drop one. */
async function queueAction(user: User, intent: "release" | "cancel", id: string): Promise<Response> {
  if (intent === "cancel") {
    const { name, orphaned } = await convex.mutation(api.schedule.cancel, { userId: user._id, id });
    if (orphaned > 0) await deleteOrphanedMedia();
    return redirectWithFlash("/new", { tone: "success", message: `${name} is off the schedule.` });
  }
  const out = await releaseScheduled(user, id);
  const flash = launchFlash(out.title, out.finished, out.blurred);
  const here = slopPath(user.username, out.slug);
  return redirectWithFlash(flash.tone === "error" ? here : `${here}?new=1`, flash);
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireUser(context.get(viewerContext), request);
  const form = await request.formData();
  const intent = formText(form, "intent");
  if (intent === "release" || intent === "cancel") {
    try {
      return await queueAction(user, intent, formText(form, "id"));
    } catch (error) {
      const message = convexMessage(error);
      if (message) return redirectWithFlash("/new", { tone: "error", message });
      throw error;
    }
  }

  const parsed = parseSlopForm(form);
  const source = await relaunchSource(user, formText(form, "relaunchOf") || null);
  const label = formText(form, "launchLabel");

  const errors: Record<string, string> = parsed.ok ? {} : { ...parsed.errors };
  if (source && !label) errors.launchLabel = "Say what's launching: a platform, a version, a new app.";
  if (label.length > LIMITS.launchLabelLength) {
    errors.launchLabel = `Keep it under ${LIMITS.launchLabelLength} characters.`;
  }
  const when = formText(form, "when") || "now";
  const releaseAt = formText(form, "releaseAt");
  let release: ReleaseWhen = { kind: "now" };
  if (when === "next") release = { kind: "next" };
  if (when === "at") {
    const picked = parseRelease(releaseAt, user.timeZone);
    const problem = picked?.kind === "at" ? releaseProblem(picked.at, Date.now()) : "Pick a day and a time.";
    if (picked && !problem) release = picked;
    else errors.releaseAt = problem ?? "Pick a day and a time.";
  }
  if (!parsed.ok || Object.keys(errors).length > 0) {
    const values = slopFormValues(form);
    return data(
      {
        errors,
        values: {
          ...values,
          screenshots: await screenshotsWithUrls(values.screenshots),
          launchLabel: label,
          when,
          releaseAt,
        },
      },
      { status: 422 },
    );
  }

  const { launchNote, ...input } = parsed.value;
  const title = launchTitle({ name: input.name, launchLabel: source ? label : null });
  const autopost = form.get("autopost") === "on";
  const relaunch = source ? { relaunchOf: source._id, launchLabel: label } : {};
  try {
    if (release.kind !== "now") {
      const queued = await convex.mutation(api.schedule.add, {
        userId: user._id,
        input,
        launchNote: launchNote || input.tagline,
        when: release,
        autopost,
        ...relaunch,
      });
      return redirectWithFlash("/new", {
        tone: "success",
        message: `${title} goes out ${formatRelease(queued.releaseAt, user.timeZone)}.`,
      });
    }
    const created = await convex.mutation(api.slops.create, {
      userId: user._id,
      input,
      launchNote: launchNote || input.tagline,
      today: localDate(new Date(), user.timeZone),
      ...relaunch,
    });
    const finished = await finishLaunch(user, created, launchNote, autopost);
    const here = slopPath(user.username, created.slug);
    const flash = launchFlash(title, finished, created.blurred);
    return redirectWithFlash(flash.tone === "error" ? here : `${here}?new=1`, flash);
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash("/new", { tone: "error", message });
    throw error;
  }
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, {
    title: loaderData?.relaunch ? `Launch ${loaderData.relaunch.name} again` : "New slop",
    noindex: true,
  });

export default function NewSlop({ loaderData, actionData }: Route.ComponentProps) {
  const { goal, autopost, relaunch, schedule } = loaderData;
  const queue = useLive(api.schedule.mine, {}, schedule.queue) ?? schedule.queue;
  const networks = useAutopostNetworks();
  const navigation = useNavigation();
  const submitting =
    navigation.state === "submitting" &&
    (navigation.formAction ?? "").startsWith("/new") &&
    !navigation.formData?.has("intent");
  const errors: Record<string, string> = actionData?.errors ?? {};
  const values = actionData?.values ?? relaunch?.values ?? {};
  const [when, setWhen] = useState(actionData?.values.when ?? "now");
  const submitLabel =
    when === "now" ? { idle: "Throw it at the wall", busy: "Throwing…" } : { idle: "Schedule it", busy: "Scheduling…" };
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
          ? "A new platform, app or 2.0 gets its own shot at slop of the day. Features go in updates."
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
      {queue.length > 0 && <Scheduled queue={queue} timeZone={schedule.timeZone} />}
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
              hint="A platform, a version (2.0) or a new app built from it."
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
              Auto-post to {listWords(networks, "or")}?{" "}
              <Link to="/settings/autopost" className="link text-ink">
                Connect accounts
              </Link>
              .
            </p>
          )}
          <ReleaseChoice
            when={when}
            onChange={setWhen}
            nextFree={schedule.nextFree}
            timeZone={schedule.timeZone}
            releaseAt={actionData?.values.releaseAt}
            error={errors.releaseAt}
          />
          <button type="submit" className="btn btn-slop btn-lg w-full text-[1.125rem]" disabled={submitting}>
            {submitting ? submitLabel.busy : submitLabel.idle}
          </button>
        </div>
      </Form>
    </section>
  );
}

const CHOICE =
  "block h-full rounded-2xl bg-sunk p-4 transition-colors peer-checked:bg-ink peer-checked:text-ground peer-not-checked:hover:bg-line peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--focus)";

/**
 * Now, the next free day, or a picked time. The picker shows only with
 * "Pick a time" chosen, in CSS, so it works before the page hydrates.
 */
function ReleaseChoice({
  when,
  onChange,
  nextFree,
  timeZone,
  releaseAt,
  error,
}: {
  when: string;
  onChange: (when: string) => void;
  nextFree: number | null;
  timeZone: string;
  releaseAt: string | undefined;
  error: string | undefined;
}) {
  const options = [
    { id: "now", label: "Now", blurb: "Straight onto the wall." },
    {
      id: "next",
      label: "Next free day",
      blurb: nextFree
        ? `${formatRelease(nextFree, timeZone)}, when its race starts: a full day of votes.`
        : "The first day with nothing out or scheduled.",
    },
    { id: "at", label: "Pick a time", blurb: `Any time in the next ${LIMITS.scheduleDays} days.` },
  ];
  return (
    <fieldset className="group grid gap-3">
      <legend className="field-label">When does it go out?</legend>
      <div className="grid gap-3 sm:grid-cols-3">
        {options.map((option) => (
          <label key={option.id} className="cursor-pointer">
            <input
              type="radio"
              name="when"
              id={`when-${option.id}`}
              value={option.id}
              checked={when === option.id}
              onChange={() => onChange(option.id)}
              className="peer sr-only"
            />
            <span className={CHOICE}>
              <span className="block font-bold">{option.label}</span>
              <span className="mt-1 block text-[0.9375rem] opacity-75">{option.blurb}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="hidden group-has-[#when-at:checked]:block">
        <Field
          id="releaseAt"
          label="Day and time"
          error={error}
          hint={`In your time zone, ${timeZone.replaceAll("_", " ")}.`}
        >
          <input
            id="releaseAt"
            name="releaseAt"
            type="datetime-local"
            className="input"
            defaultValue={releaseAt ?? (nextFree ? localDateTimeValue(nextFree, timeZone) : "")}
          />
        </Field>
      </div>
      <p className="field-hint">Each slop counts on the day it goes out. Three today is three.</p>
    </fieldset>
  );
}

type QueueItem = Route.ComponentProps["loaderData"]["schedule"]["queue"][number];

/** What's waiting to go out, soonest first, each with a way to throw it now or drop it. */
function Scheduled({ queue, timeZone }: { queue: QueueItem[]; timeZone: string }) {
  return (
    <section aria-labelledby="scheduled" className="mt-10">
      <h2 id="scheduled" className="caps">
        Scheduled
      </h2>
      <ul className="mt-3 grid gap-3">
        {queue.map((item) => {
          const title = launchTitle(item);
          return (
            <li key={item.id} className="panel flex flex-wrap items-center gap-4">
              {item.cover ? (
                <img src={item.cover} alt="" className="size-14 shrink-0 rounded-xl object-cover" />
              ) : (
                <span aria-hidden="true" className="grid size-14 shrink-0 place-items-center rounded-xl bg-sunk">
                  <Icon name="clock" className="size-6 text-muted" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="font-bold break-words">{title}</p>
                <p className="text-[0.9375rem] text-muted">
                  {item.out
                    ? "Out now, finishing the check and auto-post."
                    : `Goes out ${formatRelease(item.releaseAt, timeZone)}`}
                  {!item.out && item.autopost ? " · Auto-posts" : ""}
                </p>
              </div>
              <Form method="post" className="flex flex-wrap gap-2">
                <input type="hidden" name="id" value={item.id} />
                {item.out ? (
                  <button
                    type="submit"
                    name="intent"
                    value="release"
                    className="btn btn-ink btn-sm"
                    aria-label={`Finish it: ${title}`}
                  >
                    Finish it
                  </button>
                ) : (
                  <>
                    <button
                      type="submit"
                      name="intent"
                      value="release"
                      className="btn btn-slop btn-sm"
                      aria-label={`Throw it now: ${title}`}
                    >
                      Throw it now
                    </button>
                    <button
                      type="submit"
                      name="intent"
                      value="cancel"
                      className="btn btn-quiet btn-sm"
                      aria-label={`Unschedule: ${title}`}
                    >
                      Unschedule
                    </button>
                  </>
                )}
              </Form>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
