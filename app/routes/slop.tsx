import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/slop";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { absoluteUrl } from "~/.server/config";
import { formText } from "~/.server/forms";
import { badRequest, forbidden, notFound, redirectWithFlash } from "~/.server/http";
import { announce, retryFailed, summarize } from "~/.server/social/announce";
import { modeFor } from "~/.server/social/crosspost";
import { shareIntents } from "~/lib/compose";
import { formatDay, localDate, timeAgo } from "~/lib/dates";
import { dayLabel, launchTitle, numberLabel, plural, slopPath } from "~/lib/display";
import { parseAmount } from "~/lib/money";
import {
  COST_CATEGORIES,
  FLAG_REASONS,
  isPostableUpdateKind,
  LIMITS,
  LINK_KINDS,
  POSTABLE_UPDATE_KINDS,
  type PostableUpdateKind,
  REVENUE_CATEGORIES,
  UPDATE_KINDS,
} from "~/lib/model";
import { CURRENCIES } from "~/lib/money";
import { isIsoDate } from "~/lib/dates";
import { seo } from "~/lib/seo";
import { Avatar } from "~/components/Avatar";
import { CrosspostReceipts } from "~/components/Autopost";
import { Markdown, ShareBox } from "~/components/Shared";
import {
  CategoryLink,
  LaunchLabelTag,
  NsfwTag,
  Platforms,
  SlopcessfulTag,
  SlopOfTheDayTag,
} from "~/components/SlopBits";
import { UPDATE_KIND_TONES } from "~/components/UpdatesList";
import { Icon } from "~/components/Icon";
import { VoteButtons } from "~/components/VoteButtons";
import { TakeMyMoney } from "~/components/TakeMyMoney";
import { MoneyLedger, MoneySummary } from "~/components/Money";
import { AgentPrompt } from "~/components/AgentPrompt";
import { useLive } from "~/components/Live";
import { updatePrompt } from "~/lib/prompts";

function parseHandle(handle: string): string {
  if (!handle.startsWith("@")) notFound();
  return handle.slice(1).toLowerCase();
}

export async function loader({ params, context }: Route.LoaderArgs) {
  const viewer = context.get(viewerContext);
  const username = parseHandle(params.handle);
  const page = await convex.query(api.slops.page, {
    username,
    slug: params.slug,
    asUser: viewer.user?._id,
    isAdmin: viewer.isAdmin,
  });
  if (!page) notFound();
  const { slop, owner } = page;

  let autopostCount = 0;
  if (page.isOwner && viewer.user) {
    const [doc, accounts] = await Promise.all([
      convex.query(api.slops.getForServer, { slopId: slop.id }),
      convex.query(api.accounts.list, { userId: viewer.user._id }),
    ]);
    if (doc) autopostCount = accounts.filter((account) => modeFor(doc, account) !== "off").length;
  }
  const url = absoluteUrl(slopPath(owner.username, slop.slug));
  const day = dayLabel(slop);
  return {
    page,
    username,
    slug: params.slug,
    extras: {
      isAdmin: viewer.isAdmin,
      signedIn: viewer.user !== null,
      autopostCount,
      today: localDate(new Date(), page.ownerTimeZone),
      url,
      intents: shareIntents(
        `${launchTitle(slop)}: ${slop.tagline}${day ? ` (${day} by @${owner.username})` : ""}`,
        url,
      ),
    },
  };
}

/** Wraps a Convex business-rule error into a flash, rethrowing anything else. */
async function attempt(here: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash(here, { tone: "error", message });
    throw error;
  }
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const viewer = context.get(viewerContext);
  const user = requireUser(viewer, request);
  const username = parseHandle(params.handle);
  const page = await convex.query(api.slops.page, {
    username,
    slug: params.slug,
    asUser: user._id,
    isAdmin: viewer.isAdmin,
  });
  if (!page) notFound();
  const { slop, owner, isOwner } = page;
  const ownerRef = { _id: owner.id, username: owner.username };
  const here = slopPath(owner.username, slop.slug);
  const form = await request.formData();
  const intent = formText(form, "intent");

  return await attempt(here, async () => {
    switch (intent) {
      case "comment": {
        const body = formText(form, "body");
        const kind = formText(form, "kind") === "kudos" ? "kudos" : "feedback";
        if (!body || body.length > LIMITS.commentLength) {
          return redirectWithFlash(`${here}#feedback`, {
            tone: "error",
            message: `Feedback is 1 to ${LIMITS.commentLength} characters.`,
          });
        }
        const commentId = await convex.mutation(api.activity.addComment, {
          userId: user._id,
          slopId: slop.id,
          kind,
          body,
        });
        return redirectWithFlash(`${here}#comment-${commentId}`, {
          tone: "success",
          message: kind === "kudos" ? "Kudos sent. 🔥" : "Feedback posted.",
        });
      }

      case "delete-comment": {
        await convex.mutation(api.activity.deleteComment, {
          userId: user._id,
          commentId: formText(form, "id"),
          asAdmin: viewer.isAdmin,
        });
        return redirectWithFlash(`${here}#feedback`, { tone: "info", message: "Removed." });
      }

      case "update": {
        if (!isOwner) forbidden();
        const kind = formText(form, "kind");
        const body = formText(form, "body");
        if (!isPostableUpdateKind(kind)) badRequest("Unknown update kind");
        if (!body || body.length > LIMITS.updateLength) {
          return redirectWithFlash(`${here}#updates`, {
            tone: "error",
            message: `Updates are 1 to ${LIMITS.updateLength} characters.`,
          });
        }
        const updateId = await convex.mutation(api.activity.addUpdate, {
          userId: user._id,
          slopId: slop.id,
          kind,
          body,
        });
        const autoposted = form.get("autopost") === "on" ? summarize(await announce(ownerRef, slop.id, updateId)) : "";
        return redirectWithFlash(`${here}#update-${updateId}`, {
          tone: "success",
          message: `${UPDATE_KINDS[kind].label} posted.${autoposted}`,
        });
      }

      case "slopcessful": {
        if (!isOwner) forbidden();
        const note = formText(form, "note");
        if (!note) {
          return redirectWithFlash(`${here}#slopcessful`, {
            tone: "error",
            message: "Say what happened: users, revenue, a viral post…",
          });
        }
        const updateId = await convex.mutation(api.slops.setSlopcessful, { userId: user._id, slopId: slop.id, note });
        const autoposted =
          updateId && form.get("autopost") === "on" ? summarize(await announce(ownerRef, slop.id, updateId)) : "";
        return redirectWithFlash(here, { tone: "success", message: `Slopcessful. Keep slopping.${autoposted}` });
      }

      case "unslopcessful": {
        if (!isOwner) forbidden();
        await convex.mutation(api.slops.setSlopcessful, { userId: user._id, slopId: slop.id, note: null });
        return redirectWithFlash(here, { tone: "info", message: "Slopcessful badge removed." });
      }

      case "money-add": {
        if (!isOwner) forbidden();
        const amount = parseAmount(formText(form, "amount"));
        const kind = formText(form, "kind") === "revenue" ? "revenue" : "cost";
        const currency = formText(form, "currency") || "USD";
        const category = formText(form, "category") || "other";
        const note = formText(form, "note");
        const date = formText(form, "date") || localDate(new Date(), user.timeZone);
        const categories: readonly string[] = kind === "cost" ? COST_CATEGORIES : REVENUE_CATEGORIES;
        const problem =
          amount === null
            ? "Enter an amount like 12.99."
            : !(CURRENCIES as readonly string[]).includes(currency)
              ? "Pick a currency from the list."
              : !categories.includes(category)
                ? "Pick a category from the list."
                : !isIsoDate(date)
                  ? "Pick a date."
                  : note.length > LIMITS.ledgerNoteLength
                    ? `Keep the note under ${LIMITS.ledgerNoteLength} characters.`
                    : null;
        if (problem || amount === null) {
          return redirectWithFlash(`${here}#money`, { tone: "error", message: problem ?? "Enter an amount." });
        }
        await convex.mutation(api.money.add, {
          userId: user._id,
          slopId: slop.id,
          kind,
          amount,
          currency,
          category,
          note,
          date,
        });
        return redirectWithFlash(`${here}#money`, {
          tone: "success",
          message: kind === "cost" ? "Cost logged." : "Revenue logged. 💸",
        });
      }

      case "money-delete": {
        if (!isOwner) forbidden();
        await convex.mutation(api.money.remove, { userId: user._id, entryId: formText(form, "id") });
        return redirectWithFlash(`${here}#money`, { tone: "info", message: "Removed." });
      }

      case "money-visibility": {
        if (!isOwner) forbidden();
        const visible = formText(form, "public") === "on";
        await convex.mutation(api.money.setPublic, { userId: user._id, slopId: slop.id, visible });
        return redirectWithFlash(`${here}#money`, {
          tone: "info",
          message: visible ? "Your numbers are public now." : "Your numbers are private.",
        });
      }

      case "retry-autopost": {
        if (!isOwner) forbidden();
        const outcome = await retryFailed(ownerRef, formText(form, "id"));
        if (outcome.status === "held") {
          return redirectWithFlash(`${here}#updates`, { tone: "error", message: `Not posted: ${outcome.reason}.` });
        }
        const failed = outcome.results.filter((result) => result.status === "error").length;
        return redirectWithFlash(`${here}#updates`, {
          tone: failed ? "error" : "success",
          message: failed ? `${failed} account${failed === 1 ? "" : "s"} still failing.` : "Posted.",
        });
      }

      case "delete-update": {
        if (!isOwner) forbidden();
        await convex.mutation(api.activity.deleteUpdate, {
          userId: user._id,
          updateId: formText(form, "id"),
        });
        return redirectWithFlash(`${here}#updates`, { tone: "info", message: "Removed." });
      }

      case "flag": {
        const reason = formText(form, "reason");
        if (!(FLAG_REASONS as readonly string[]).includes(reason)) badRequest("Pick a reason");
        const details = formText(form, "details").slice(0, 400);
        await convex.mutation(api.moderation.flag, {
          userId: user._id,
          slopId: slop.id,
          reason: details ? `${reason}: ${details}` : reason,
        });
        return redirectWithFlash(here, { tone: "info", message: "Flagged. Thanks, a moderator will look at it." });
      }

      case "hide":
      case "unhide": {
        if (!viewer.isAdmin) forbidden();
        await convex.mutation(api.slops.setHidden, { slopId: slop.id, hidden: intent === "hide" });
        return redirectWithFlash(here, {
          tone: "info",
          message: intent === "hide" ? "Hidden from Slopper." : "Visible again.",
        });
      }

      case "delete": {
        if (!isOwner && !viewer.isAdmin) forbidden();
        if (formText(form, "confirm") !== slop.slug) {
          return redirectWithFlash(`${here}/edit#delete`, {
            tone: "error",
            message: `Type “${slop.slug}” to confirm.`,
          });
        }
        await convex.mutation(api.slops.remove, { slopId: slop.id, byUserId: user._id, asAdmin: viewer.isAdmin });
        return redirectWithFlash(`/@${owner.username}`, {
          tone: "info",
          message: `${launchTitle(slop)} was scraped off the wall.`,
        });
      }

      default:
        badRequest("Unknown action");
    }
  });
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  loaderData
    ? seo(matches, {
        title: `${launchTitle(loaderData.page.slop)} by @${loaderData.page.owner.username}`,
        description: loaderData.page.slop.tagline,
        image:
          loaderData.page.slop.screenshots[0] && !loaderData.page.slop.nsfw
            ? loaderData.page.slop.screenshots[0]
            : null,
        path: slopPath(loaderData.page.owner.username, loaderData.page.slop.slug),
        noindex: loaderData.page.slop.hidden || loaderData.page.slop.nsfw,
      })
    : seo(matches);

type PageData = NonNullable<Route.ComponentProps["loaderData"]["page"]>;
type View = PageData & Route.ComponentProps["loaderData"]["extras"];

export default function SlopPage({ loaderData: data }: Route.ComponentProps) {
  // Live: votes, pledges, updates and feedback from everyone land here as they happen.
  const page = useLive(api.slops.page, { username: data.username, slug: data.slug }, data.page) ?? data.page;
  const loaderData: View = { ...page, ...data.extras };
  const { owner, slop, isOwner, intents } = loaderData;
  const [search] = useSearchParams();
  const reveal = loaderData.reveal || search.get("reveal") === "1";
  const path = slopPath(owner.username, slop.slug);
  const day = dayLabel(slop);
  const primary = slop.links.find((link) => link.kind === "website") ?? slop.links[0];

  return (
    <>
      {slop.hidden && (
        <p className="bg-hot px-4 py-2.5 text-center font-bold text-hot-ink">
          {loaderData.heldForReview ? "Held for review" : "Hidden by a moderator"}. Only you
          {loaderData.isAdmin ? " and mods" : ""} can see this.
        </p>
      )}

      {search.get("new") === "1" && isOwner && (
        <section className="bg-slop text-slop-ink">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5">
            <p className="text-[1.125rem] font-bold">
              It's on the wall. Now tell people. Anything not auto-posted is one tap away:
            </p>
            <div className="flex flex-wrap gap-2">
              {(["x", "linkedin", "bluesky", "threads"] as const).map((network) => (
                <a
                  key={network}
                  className="btn btn-sm bg-slop-ink text-slop hover:bg-slop-ink/85"
                  href={intents[network]}
                  target="_blank"
                  rel="noopener"
                >
                  {network === "x" ? "Post on X" : network[0].toUpperCase() + network.slice(1)}
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      <article className="mx-auto max-w-6xl px-4 pt-10">
        <nav className="text-muted" aria-label="Breadcrumb">
          <Link to={`/@${owner.username}`} className="-my-3 inline-block py-3 font-bold hover:text-ink">
            @{owner.username}
          </Link>{" "}
          / {slop.slug}
        </nav>

        <header className="mt-8">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
            <div className="min-w-0">
              <h1 className="display break-words">{slop.name}</h1>
              <p className="mt-4 max-w-2xl text-[1.3rem] leading-snug text-muted sm:text-[1.5rem]">{slop.tagline}</p>
              {(slop.launchLabel || slop.slopcessfulAt || slop.slopOfTheDay || slop.nsfw) && (
                <p className="mt-5 flex flex-wrap gap-1.5">
                  {slop.launchLabel && <LaunchLabelTag label={slop.launchLabel} />}
                  {slop.slopOfTheDay && <SlopOfTheDayTag date={slop.slopOfTheDay} />}
                  {slop.slopcessfulAt && <SlopcessfulTag />}
                  {slop.nsfw && <NsfwTag />}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 lg:justify-end">
              <VoteButtons
                slopId={slop.id}
                upvotes={slop.upvotes}
                vote={loaderData.vote}
                mode={loaderData.voteMode}
                loginHref={`/login?returnTo=${encodeURIComponent(path)}`}
                size="lg"
              />
              {primary && (
                <a href={primary.url} target="_blank" rel="noopener" className="btn btn-slop btn-lg">
                  {LINK_KINDS[primary.kind].beta ? "Join the beta" : "Try it"}
                  <Icon name="out" className="size-5" />
                </a>
              )}
            </div>
          </div>
          {slop.slopcessfulAt && slop.slopcessfulNote && (
            <p className="mt-8 rounded-2xl bg-gold-tint px-5 py-4 text-[1.125rem] font-bold">
              ★ Slopcessful: {slop.slopcessfulNote}
            </p>
          )}
          <dl className="mt-8 flex flex-wrap gap-x-8 gap-y-3 border-y border-line py-4 text-[0.9375rem]">
            <Fact label={`Slop ${numberLabel(slop)}`}>
              {day ? `${day} · ` : ""}Launched {formatDay(slop.launchDate)}
            </Fact>
            <Fact label="Category">
              <CategoryLink category={slop.category} />
            </Fact>
            {slop.links.length > 0 && (
              <Fact label="Try it on">
                <Platforms links={slop.links} />
              </Fact>
            )}
            {slop.madeWith.length > 0 && <Fact label="Made with">{slop.madeWith.join(", ")}</Fact>}
          </dl>
        </header>

        {slop.screenshots.length > 0 && (
          <section className="relative mt-10" aria-label="Screenshots">
            <div className="scrollbar-none -mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-2">
              {slop.screenshots.map((url, index) => (
                <a
                  key={url}
                  href={reveal ? url : "?reveal=1"}
                  target={reveal ? "_blank" : undefined}
                  rel="noopener"
                  className="relative shrink-0 snap-start overflow-hidden rounded-2xl bg-sunk"
                >
                  <img
                    src={url}
                    alt={`${slop.name} screenshot ${index + 1}`}
                    loading={index === 0 ? "eager" : "lazy"}
                    className={`h-64 w-auto max-w-[85vw] object-contain sm:h-96 ${reveal ? "" : "scale-110 blur-2xl"}`}
                  />
                </a>
              ))}
            </div>
            {!reveal && (
              <div className="absolute inset-0 grid place-items-center">
                <a href="?reveal=1" className="btn btn-ink btn-lg">
                  NSFW · show anyway
                </a>
              </div>
            )}
          </section>
        )}

        <div className="mt-14 grid gap-x-16 gap-y-16 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {slop.description && (
              <section aria-labelledby="about">
                <h2 id="about" className="title-2">
                  About
                </h2>
                <Markdown html={loaderData.descriptionHtml} className="mt-5 max-w-[68ch] text-[1.125rem]" />
              </section>
            )}

            {loaderData.launches.length > 1 && <LaunchHistory loaderData={loaderData} />}
            <Updates loaderData={loaderData} />
            <Feedback loaderData={loaderData} path={path} />
          </div>

          <Sidebar loaderData={loaderData} path={path} />
        </div>
      </article>
    </>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="font-bold">{children}</dd>
    </div>
  );
}

type LoaderData = View;

function LaunchHistory({ loaderData }: { loaderData: LoaderData }) {
  return (
    <section className="mt-16" aria-labelledby="launches-title">
      <h2 id="launches-title" className="title-2">
        Launches
      </h2>
      <p className="mt-2 text-muted">Every launch of {loaderData.slop.name} races on its own day.</p>
      <ol className="mt-6 divide-y divide-line border-y border-line">
        {loaderData.launches.map((launch) => {
          const current = launch.id === loaderData.slop.id;
          return (
            <li key={launch.id}>
              <Link
                to={slopPath(loaderData.owner.username, launch.slug)}
                aria-current={current ? "page" : undefined}
                className="group flex min-h-14 flex-wrap items-center gap-x-4 gap-y-1 py-3"
              >
                <span className="font-mono text-sm text-muted">#{String(launch.number).padStart(4, "0")}</span>
                <span className={`font-bold group-hover:underline ${current ? "text-ink" : ""}`}>{launch.title}</span>
                {current && <span className="tag">You're here</span>}
                <span className="text-muted">{formatDay(launch.launchDate)}</span>
                {launch.slopOfTheDay && <span className="tag tag-gold">Slop of the day</span>}
                <span className="ml-auto inline-flex items-center gap-1 font-display text-[1.25rem] font-extrabold tabular-nums">
                  <Icon name="up" className="size-4 text-muted" />
                  {launch.upvotes}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Updates({ loaderData }: { loaderData: LoaderData }) {
  const { updates, isOwner } = loaderData;
  return (
    <section id="updates" className="mt-16 scroll-mt-24" aria-labelledby="updates-title">
      <div className="flex items-baseline justify-between gap-4">
        <h2 id="updates-title" className="title-2">
          Updates
        </h2>
        <span className="text-muted">{plural(updates.length, "update", "updates")}</span>
      </div>
      {isOwner && (
        <div className="mt-6 grid gap-3">
          <AgentPrompt prompt={(origin) => updatePrompt(origin, loaderData.slop.slug)} />
          <UpdateComposer autopostCount={loaderData.autopostCount} />
        </div>
      )}
      <ol className="mt-8 grid gap-0">
        {updates.map((update) => (
          <li
            key={update.id}
            id={`update-${update.id}`}
            className="relative scroll-mt-24 border-l border-line-strong pb-9 pl-6 last:pb-2"
          >
            <span
              aria-hidden="true"
              className={`absolute top-[0.45rem] -left-[5px] size-[9px] rounded-full ${
                update.kind === "launch" ? "bg-slop" : update.kind === "slopcessful" ? "bg-gold" : "bg-ink"
              }`}
            />
            <p className="flex flex-wrap items-baseline gap-x-2.5">
              <span className={`caps ${UPDATE_KIND_TONES[update.kind]}`}>{UPDATE_KINDS[update.kind].label}</span>
              <span className="text-sm text-muted">{timeAgo(update.createdAt)}</span>
            </p>
            {update.html && <Markdown html={update.html} className="mt-2 max-w-[68ch]" />}
            {isOwner && update.crossposts.length > 0 && <CrosspostReceipts update={update} />}
            {isOwner && update.kind !== "launch" && (
              <Form method="post" className="mt-1">
                <input type="hidden" name="intent" value="delete-update" />
                <input type="hidden" name="id" value={update.id} />
                <button type="submit" className="min-h-11 text-sm text-muted underline hover:text-hot">
                  Delete
                </button>
              </Form>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

const COMPOSER_HINTS: Record<PostableUpdateKind, string> = {
  update: "Fixed the bug where the marble fell through the floor.",
  feature: "Added dark mode and a level editor.",
  field: "Showed it to 5 people at the bus stop. 3 got hooked, one asked for multiplayer.",
  repromote: "Still alive. 200 people played this week. Come try the new levels.",
};

function UpdateComposer({ autopostCount }: { autopostCount: number }) {
  const [search] = useSearchParams();
  const initial = search.get("kind");
  const [kind, setKind] = useState<PostableUpdateKind>(initial && isPostableUpdateKind(initial) ? initial : "update");
  return (
    <Form method="post" className="panel">
      <input type="hidden" name="intent" value="update" />
      <fieldset className="flex flex-wrap gap-1.5">
        <legend className="sr-only">Kind of update</legend>
        {POSTABLE_UPDATE_KINDS.map((option) => (
          <label key={option} className="cursor-pointer">
            <input
              type="radio"
              name="kind"
              value={option}
              checked={kind === option}
              onChange={() => setKind(option)}
              className="peer sr-only"
            />
            <span className="flex min-h-10 items-center rounded-lg px-3 font-bold text-muted transition-colors peer-checked:bg-ink peer-checked:text-ground peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-(--focus) hover:text-ink">
              {UPDATE_KINDS[option].label}
            </span>
          </label>
        ))}
      </fieldset>
      {kind === "field" && (
        <p className="mt-3 text-[0.9375rem] text-muted">
          Who tried it in real life, and what did they say? Field tests count extra in the rankings.
        </p>
      )}
      <label htmlFor="update-body" className="sr-only">
        Update
      </label>
      <textarea
        id="update-body"
        name="body"
        required
        maxLength={LIMITS.updateLength}
        className="input mt-3 min-h-24"
        placeholder={COMPOSER_HINTS[kind]}
      />
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        {autopostCount > 0 ? (
          <label className="flex min-h-11 items-center gap-2">
            <input type="checkbox" name="autopost" defaultChecked className="size-4" />
            Auto-post ({autopostCount} account{autopostCount === 1 ? "" : "s"})
          </label>
        ) : (
          <Link
            to="/settings/autopost"
            className="inline-flex min-h-11 items-center text-muted underline hover:text-ink"
          >
            Connect X, LinkedIn or Bluesky
          </Link>
        )}
        <button type="submit" className="btn btn-slop">
          Post update
        </button>
      </div>
    </Form>
  );
}

const OUTSIDE_IDEAS = [
  "Hand your phone to someone and watch them use it without helping.",
  "Drop it in a group chat and ask for one honest reaction.",
  "Demo it at a meetup, a café, or a class.",
  "DM five people who would actually use it.",
];

function GoOutside({ path }: { path: string }) {
  return (
    <section aria-labelledby="outside-title">
      <h2 id="outside-title" className="font-display text-[1.75rem] leading-none font-extrabold">
        Go outside
      </h2>
      <p className="mt-2">Slop gets better when real people touch it. Today, try one:</p>
      <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-[0.9375rem] marker:text-muted">
        {OUTSIDE_IDEAS.map((idea) => (
          <li key={idea}>{idea}</li>
        ))}
      </ul>
      <Link to={`${path}?kind=field#updates`} className="btn btn-sm mt-4">
        Log a field test
      </Link>
    </section>
  );
}

function Feedback({ loaderData, path }: { loaderData: LoaderData; path: string }) {
  const { comments } = loaderData;
  return (
    <section id="feedback" className="mt-16 scroll-mt-24" aria-labelledby="feedback-title">
      <h2 id="feedback-title" className="title-2">
        Feedback
      </h2>
      <ol className="mt-6 grid gap-3">
        {comments.length === 0 && (
          <li className="rounded-2xl bg-sunk p-5 text-muted">
            Nothing yet. Tried it? Say what worked, what broke, or just tell them it's good.
          </li>
        )}
        {comments.map((comment) => (
          <li key={comment.id} id={`comment-${comment.id}`} className="scroll-mt-24 rounded-2xl bg-sunk p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {comment.author && <Avatar user={comment.author} size="xs" />}
              {comment.author ? (
                <Link to={`/@${comment.author.username}`} className="-my-2.5 py-2.5 font-bold hover:underline">
                  @{comment.author.username}
                </Link>
              ) : (
                <span className="font-bold">Deleted account</span>
              )}
              {comment.kind === "kudos" && <span className="tag bg-ink text-ground">This is good</span>}
              <span className="ml-auto text-sm text-muted">{timeAgo(comment.createdAt)}</span>
            </div>
            <Markdown html={comment.html} className="mt-2" />
            {comment.canDelete && (
              <Form method="post" className="text-right">
                <input type="hidden" name="intent" value="delete-comment" />
                <input type="hidden" name="id" value={comment.id} />
                <button type="submit" className="min-h-11 text-sm text-muted underline hover:text-ink">
                  Delete
                </button>
              </Form>
            )}
          </li>
        ))}
      </ol>
      {loaderData.signedIn ? (
        <Form method="post" className="mt-6">
          <input type="hidden" name="intent" value="comment" />
          <label htmlFor="comment-body" className="field-label">
            Your feedback
          </label>
          <textarea
            id="comment-body"
            name="body"
            required
            maxLength={LIMITS.commentLength}
            className="input min-h-28"
            placeholder="What worked? What broke? What should it do next?"
          />
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="submit" name="kind" value="kudos" className="btn">
              🔥 This is good
            </button>
            <button type="submit" name="kind" value="feedback" className="btn btn-ink">
              Leave feedback
            </button>
          </div>
        </Form>
      ) : (
        <Link to={`/login?returnTo=${encodeURIComponent(`${path}#feedback`)}`} className="btn btn-lg mt-6">
          Sign in to leave feedback
        </Link>
      )}
    </section>
  );
}

function Sidebar({ loaderData, path }: { loaderData: LoaderData; path: string }) {
  const { owner, slop, isOwner, signedIn } = loaderData;
  return (
    <aside className="grid content-start gap-10 lg:sticky lg:top-24 lg:self-start">
      <section aria-labelledby="maker-title">
        <h2 id="maker-title" className="caps">
          Made by
        </h2>
        <Link to={`/@${owner.username}`} className="group mt-3 flex items-center gap-3">
          <Avatar user={owner} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-bold group-hover:underline">{owner.displayName}</span>
            <span className="block truncate text-muted">@{owner.username}</span>
          </span>
        </Link>
        {slop.links.length > 0 && (
          <ul className="mt-5 divide-y divide-line border-y border-line">
            {slop.links.map((link) => (
              <li key={link.url}>
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener"
                  className="group flex min-h-12 items-center justify-between gap-3"
                >
                  <span className="font-bold group-hover:underline">{LINK_KINDS[link.kind].label}</span>
                  <span className="flex min-w-0 items-center gap-1 text-sm text-muted">
                    <span className="truncate">{new URL(link.url).hostname}</span>
                    <Icon name="out" className="size-4" />
                  </span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <TakeMyMoney
        slopId={slop.id}
        backers={slop.backers}
        pledged={slop.pledged}
        myPledge={loaderData.myPledge}
        mode={loaderData.voteMode}
        loginHref={`/login?returnTo=${encodeURIComponent(path)}`}
      />

      <ShareBox intents={loaderData.intents} url={loaderData.url} />

      {isOwner ? (
        <MoneyLedger
          totals={loaderData.money.totals}
          entries={loaderData.money.entries}
          isPublic={loaderData.money.isPublic}
          today={loaderData.today}
        />
      ) : (
        loaderData.money.isPublic && <MoneySummary totals={loaderData.money.totals} />
      )}

      {isOwner && <GoOutside path={path} />}

      {isOwner && (
        <section id="slopcessful" className="scroll-mt-24" aria-labelledby="slopcessful-title">
          <h2 id="slopcessful-title" className="caps">
            Slopcessful?
          </h2>
          {slop.slopcessfulAt ? (
            <Form method="post" className="mt-2">
              <input type="hidden" name="intent" value="unslopcessful" />
              <p>Marked {formatDay(new Date(slop.slopcessfulAt).toISOString().slice(0, 10))}.</p>
              <button type="submit" className="min-h-11 text-sm text-muted underline hover:text-ink">
                Remove the badge
              </button>
            </Form>
          ) : (
            <Form method="post" className="mt-2 grid gap-2.5">
              <input type="hidden" name="intent" value="slopcessful" />
              <p className="text-[0.9375rem] text-muted">
                Did this one break out? Users, revenue, a post that blew up?
              </p>
              <input
                name="note"
                className="input"
                required
                maxLength={LIMITS.slopcessfulNoteLength}
                placeholder="10k users in a week"
                aria-label="What happened"
              />
              {loaderData.autopostCount > 0 && (
                <label className="flex min-h-11 items-center gap-2">
                  <input type="checkbox" name="autopost" defaultChecked className="size-4" />
                  Auto-post it
                </label>
              )}
              <button type="submit" className="btn btn-gold">
                ★ Mark slopcessful
              </button>
            </Form>
          )}
        </section>
      )}

      {isOwner && (
        <section aria-labelledby="yours-title">
          <h2 id="yours-title" className="caps">
            Your slop
          </h2>
          <div className="mt-3 grid gap-2">
            <Link to={`/new?from=${slop.id}`} className="btn btn-slop">
              🚀 Launch again
            </Link>
            <Link to={`${path}/edit`} className="btn">
              Edit details
            </Link>
            <Link to={`${path}/edit#autopost`} className="btn">
              Auto-post for this slop
            </Link>
            <a href={`/api/slops/${slop.id}`} className="btn btn-quiet">
              JSON
            </a>
          </div>
        </section>
      )}

      {loaderData.isAdmin && (
        <Form method="post" className="rounded-2xl bg-hot-tint p-5" aria-labelledby="moderation-title">
          <h2 id="moderation-title" className="caps text-ink">
            Moderation
          </h2>
          <input type="hidden" name="intent" value={slop.hidden ? "unhide" : "hide"} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="submit" className="btn btn-sm bg-raised">
              {slop.hidden ? "Unhide" : "Hide from Slopper"}
            </button>
            <Link to="/mod" className="link inline-flex min-h-11 items-center">
              Flag queue
            </Link>
          </div>
        </Form>
      )}

      {signedIn && !isOwner && <FlagForm flagged={loaderData.flaggedByMe} />}
    </aside>
  );
}

function FlagForm({ flagged }: { flagged: boolean }) {
  if (flagged) {
    return <p className="text-[0.9375rem] text-muted">You flagged this. A moderator will look at it.</p>;
  }
  return (
    <details className="border-t border-line pt-3 text-[0.9375rem]">
      <summary className="flex min-h-11 items-center font-bold text-muted hover:text-ink">
        Flag as inappropriate
      </summary>
      <Form method="post" className="mt-2 grid gap-3">
        <input type="hidden" name="intent" value="flag" />
        <fieldset className="grid gap-1">
          <legend className="sr-only">What's wrong with it?</legend>
          {FLAG_REASONS.map((reason, index) => (
            <label key={reason} className="flex min-h-9 items-center gap-2">
              <input type="radio" name="reason" value={reason} required defaultChecked={index === 0} />
              {reason}
            </label>
          ))}
        </fieldset>
        <label htmlFor="flag-details" className="sr-only">
          Details
        </label>
        <textarea
          id="flag-details"
          name="details"
          className="input min-h-20"
          maxLength={400}
          placeholder="Anything a moderator should know (optional)"
        />
        <button type="submit" className="btn btn-sm justify-self-start">
          Flag it
        </button>
      </Form>
    </details>
  );
}
