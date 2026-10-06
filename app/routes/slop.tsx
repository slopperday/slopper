import { useState } from "react";
import { Form, Link, useSearchParams } from "react-router";
import type { Route } from "./+types/slop";
import { getKv } from "~/.server/kv";
import { requireUser, viewerContext } from "~/.server/session";
import { resolveSlop } from "~/.server/routing";
import {
  addComment,
  addUpdate,
  deleteComment,
  deleteUpdate,
  getComment,
  getUpdate,
  listComments,
  listSlopUpdates,
} from "~/.server/db/activity";
import { deleteSlop, getVote, listProductLaunches, setSlopcessful, setSlopHidden } from "~/.server/db/slops";
import { listAccounts } from "~/.server/db/accounts";
import {
  addLedgerEntry,
  deleteLedgerEntry,
  isMoneyPublic,
  ledgerProblem,
  listLedger,
  setMoneyPublic,
} from "~/.server/db/money";
import { getPledge } from "~/.server/db/pledges";
import { allowAction, dismissReports, fileReport } from "~/.server/db/misc";
import { getUsersById, voteMode } from "~/.server/feed";
import { formText } from "~/.server/forms";
import { badRequest, forbidden, redirectWithFlash } from "~/.server/http";
import { renderMarkdown } from "~/.server/markdown";
import { invalidateFeeds } from "~/.server/memo";
import { absoluteUrl } from "~/.server/config";
import { announce, retryFailed, summarize } from "~/.server/social/announce";
import { shareIntents } from "~/lib/compose";
import { formatDay, localDate, timeAgo } from "~/lib/dates";
import { moneyTotals, parseAmount } from "~/lib/money";
import { dayLabel, launchTitle, mediaUrl, numberLabel, slopPath } from "~/lib/display";
import {
  type CommentKind,
  isPostableUpdateKind,
  LIMITS,
  LINK_KINDS,
  POSTABLE_UPDATE_KINDS,
  type PostableUpdateKind,
  publicSlop,
  publicUser,
  UPDATE_KINDS,
} from "~/lib/model";
import { seo } from "~/lib/seo";
import { Avatar } from "~/components/Avatar";
import { CrosspostReceipts } from "~/components/Autopost";
import { Markdown, ShareBox } from "~/components/Shared";
import { CategoryChip, PlatformChips, SlopcessfulChip, SlopOfTheDayChip } from "~/components/SlopBits";
import { UPDATE_KIND_STYLES } from "~/components/UpdatesList";
import { VoteButtons } from "~/components/VoteButtons";
import { TakeMyMoney } from "~/components/TakeMyMoney";
import { MoneyLedger, MoneySummary } from "~/components/Money";
import { AgentPrompt } from "~/components/AgentPrompt";
import { updatePrompt } from "~/lib/prompts";

export async function loader({ params, request, context }: Route.LoaderArgs) {
  const kv = await getKv();
  const viewer = context.get(viewerContext);
  const { owner, slop } = await resolveSlop(kv, params, viewer);
  const isOwner = viewer.user?.id === owner.id;
  const [updates, comments, vote, accounts, launches, moneyPublic, myPledge] = await Promise.all([
    listSlopUpdates(kv, slop.id),
    listComments(kv, slop.id),
    viewer.user ? getVote(kv, slop.id, viewer.user.id) : Promise.resolve(0 as const),
    isOwner ? listAccounts(kv, owner.id) : Promise.resolve([]),
    listProductLaunches(kv, slop.productId),
    isMoneyPublic(kv, slop.productId),
    viewer.user ? getPledge(kv, slop.id, viewer.user.id) : Promise.resolve(0),
  ]);
  const ledger = isOwner || moneyPublic ? await listLedger(kv, slop.productId) : [];
  const commenters = await getUsersById(
    kv,
    comments.map((comment) => comment.userId),
  );
  const reveal =
    !slop.nsfw || viewer.user?.showNsfw || isOwner || new URL(request.url).searchParams.get("reveal") === "1";
  const url = absoluteUrl(slopPath(owner.username, slop.slug));
  const day = dayLabel(slop);

  return {
    owner: publicUser(owner),
    slop: publicSlop(slop),
    descriptionHtml: renderMarkdown(slop.description),
    updates: updates.map((update) => ({
      id: update.id,
      kind: update.kind,
      html: renderMarkdown(update.body),
      createdAt: update.createdAt,
      // Where it was posted is the owner's business only.
      crossposts: isOwner ? update.crossposts : [],
    })),
    comments: comments.map((comment) => {
      const author = commenters.get(comment.userId);
      return {
        id: comment.id,
        kind: comment.kind,
        html: renderMarkdown(comment.body),
        createdAt: comment.createdAt,
        author: author ? publicUser(author) : null,
        canDelete: viewer.user !== null && (viewer.user.id === comment.userId || isOwner || viewer.isAdmin),
      };
    }),
    launches: launches
      .filter((launch) => !launch.hidden || isOwner)
      .map((launch) => ({
        id: launch.id,
        title: launch.launchLabel ?? "First launch",
        number: launch.number,
        launchDate: launch.launchDate,
        upvotes: launch.upvotes,
        slopOfTheDay: launch.slopOfTheDay,
        path: slopPath(owner.username, launch.slug),
      })),
    money: {
      isPublic: moneyPublic,
      totals: moneyTotals(ledger),
      // Line items stay with the owner; everyone else sees totals at most.
      entries: isOwner ? ledger : [],
      today: localDate(new Date(), owner.timeZone),
    },
    myPledge,
    vote,
    voteMode: voteMode(viewer.user, slop),
    isOwner,
    isAdmin: viewer.isAdmin,
    signedIn: viewer.user !== null,
    autopostCount: accounts.filter((account) => (slop.crosspost[account.id] ?? account.defaultMode) !== "off").length,
    reveal,
    url,
    intents: shareIntents(`${slop.name}: ${slop.tagline}${day ? ` (${day} by @${owner.username})` : ""}`, url),
  };
}

export async function action({ params, request, context }: Route.ActionArgs) {
  const viewer = context.get(viewerContext);
  const user = requireUser(viewer, request);
  const kv = await getKv();
  const { owner, slop } = await resolveSlop(kv, params, viewer);
  const here = slopPath(owner.username, slop.slug);
  const form = await request.formData();
  const intent = formText(form, "intent");
  const isOwner = user.id === owner.id;

  switch (intent) {
    case "comment": {
      const body = formText(form, "body");
      const kind: CommentKind = formText(form, "kind") === "kudos" ? "kudos" : "feedback";
      if (!body || body.length > LIMITS.commentLength) {
        return redirectWithFlash(`${here}#feedback`, {
          tone: "error",
          message: `Feedback is 1 to ${LIMITS.commentLength} characters.`,
        });
      }
      if (!(await allowAction(kv, "comment", user.id, 30, 3_600_000))) {
        return redirectWithFlash(`${here}#feedback`, {
          tone: "error",
          message: "That's a lot of feedback. Take a breather.",
        });
      }
      const comment = await addComment(kv, slop.id, user.id, kind, body);
      invalidateFeeds();
      return redirectWithFlash(`${here}#comment-${comment.id}`, {
        tone: "success",
        message: kind === "kudos" ? "Kudos sent. 🔥" : "Feedback posted.",
      });
    }

    case "delete-comment": {
      const comment = await getComment(kv, slop.id, formText(form, "id"));
      if (!comment) return redirectWithFlash(`${here}#feedback`);
      if (comment.userId !== user.id && !isOwner && !viewer.isAdmin) forbidden();
      await deleteComment(kv, comment);
      invalidateFeeds();
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
      if (!(await allowAction(kv, "update", user.id, 30, 86_400_000))) {
        return redirectWithFlash(`${here}#updates`, { tone: "error", message: "30 updates a day is plenty." });
      }
      const update = await addUpdate(kv, slop.id, user.id, kind, body);
      invalidateFeeds();
      const autoposted = form.get("autopost") === "on" ? summarize(await announce(kv, owner, slop, update)) : "";
      return redirectWithFlash(`${here}#update-${update.id}`, {
        tone: "success",
        message: `${UPDATE_KINDS[kind].label} posted.${autoposted}`,
      });
    }

    case "slopcessful": {
      if (!isOwner) forbidden();
      const note = formText(form, "note").slice(0, LIMITS.slopcessfulNoteLength);
      if (!note) {
        return redirectWithFlash(`${here}#slopcessful`, {
          tone: "error",
          message: "Say what happened: users, revenue, a viral post…",
        });
      }
      const { slop: updated, update } = await setSlopcessful(kv, slop.id, note);
      invalidateFeeds();
      const autoposted =
        update && form.get("autopost") === "on" ? summarize(await announce(kv, owner, updated, update)) : "";
      return redirectWithFlash(here, { tone: "success", message: `Slopcessful. Keep slopping.${autoposted}` });
    }

    case "unslopcessful": {
      if (!isOwner) forbidden();
      await setSlopcessful(kv, slop.id, null);
      invalidateFeeds();
      return redirectWithFlash(here, { tone: "info", message: "Slopcessful badge removed." });
    }

    case "money-add": {
      if (!isOwner) forbidden();
      const amount = parseAmount(formText(form, "amount"));
      const kind = formText(form, "kind") === "revenue" ? "revenue" : "cost";
      const entry = {
        kind,
        amount: amount ?? 0,
        currency: formText(form, "currency") || "USD",
        category: formText(form, "category") || "other",
        note: formText(form, "note"),
        date: formText(form, "date") || localDate(new Date(), owner.timeZone),
      } as const;
      const problem = amount === null ? "Enter an amount like 12.99." : ledgerProblem(entry);
      if (problem) return redirectWithFlash(`${here}#money`, { tone: "error", message: problem });
      await addLedgerEntry(kv, slop.productId, user.id, entry);
      return redirectWithFlash(`${here}#money`, {
        tone: "success",
        message: kind === "cost" ? "Cost logged." : "Revenue logged. 💸",
      });
    }

    case "money-delete": {
      if (!isOwner) forbidden();
      await deleteLedgerEntry(kv, slop.productId, formText(form, "id"));
      return redirectWithFlash(`${here}#money`, { tone: "info", message: "Removed." });
    }

    case "money-visibility": {
      if (!isOwner) forbidden();
      const visible = formText(form, "public") === "on";
      await setMoneyPublic(kv, slop.productId, visible);
      return redirectWithFlash(`${here}#money`, {
        tone: "info",
        message: visible ? "Your numbers are public now." : "Your numbers are private.",
      });
    }

    case "retry-autopost": {
      if (!isOwner) forbidden();
      const update = await getUpdate(kv, slop.id, formText(form, "id"));
      if (!update) return redirectWithFlash(`${here}#updates`);
      const results = await retryFailed(kv, owner, slop, update);
      const failed = results.filter((result) => result.status === "error").length;
      return redirectWithFlash(`${here}#update-${update.id}`, {
        tone: failed ? "error" : "success",
        message: failed ? `${failed} account${failed === 1 ? "" : "s"} still failing.` : "Posted.",
      });
    }

    case "delete-update": {
      if (!isOwner) forbidden();
      const update = await getUpdate(kv, slop.id, formText(form, "id"));
      if (update && update.kind !== "launch") {
        await deleteUpdate(kv, update);
        invalidateFeeds();
      }
      return redirectWithFlash(`${here}#updates`, { tone: "info", message: "Removed." });
    }

    case "report": {
      const reason = formText(form, "reason").slice(0, 500);
      if (!(await allowAction(kv, "report", user.id, 10, 86_400_000))) {
        return redirectWithFlash(here, { tone: "error", message: "Too many reports today." });
      }
      await fileReport(kv, slop.id, user.id, reason || "No reason given");
      return redirectWithFlash(here, { tone: "info", message: "Thanks. A moderator will take a look." });
    }

    case "hide":
    case "unhide": {
      if (!viewer.isAdmin) forbidden();
      await setSlopHidden(kv, slop.id, intent === "hide");
      if (intent === "hide") await dismissReports(kv, slop.id);
      invalidateFeeds();
      return redirectWithFlash(here, {
        tone: "info",
        message: intent === "hide" ? "Hidden from Slopper." : "Visible again.",
      });
    }

    case "delete": {
      if (!isOwner && !viewer.isAdmin) forbidden();
      if (formText(form, "confirm") !== slop.slug) {
        return redirectWithFlash(`${here}/edit#delete`, { tone: "error", message: `Type “${slop.slug}” to confirm.` });
      }
      await deleteSlop(kv, slop);
      invalidateFeeds();
      return redirectWithFlash(`/@${owner.username}`, {
        tone: "info",
        message: `${slop.name} was scraped off the wall.`,
      });
    }

    default:
      badRequest("Unknown action");
  }
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  loaderData
    ? seo(matches, {
        title: `${launchTitle(loaderData.slop)} by @${loaderData.owner.username}`,
        description: loaderData.slop.tagline,
        image:
          loaderData.slop.screenshots[0] && !loaderData.slop.nsfw ? mediaUrl(loaderData.slop.screenshots[0]) : null,
        path: slopPath(loaderData.owner.username, loaderData.slop.slug),
        noindex: loaderData.slop.hidden || loaderData.slop.nsfw,
      })
    : seo(matches);

export default function SlopPage({ loaderData }: Route.ComponentProps) {
  const { owner, slop, isOwner, reveal, intents } = loaderData;
  const [search] = useSearchParams();
  const path = slopPath(owner.username, slop.slug);
  const day = dayLabel(slop);
  const primary = slop.links.find((link) => link.kind === "website") ?? slop.links[0];

  return (
    <>
      {slop.hidden && (
        <p className="bg-hot px-4 py-2 text-center font-mono text-xs tracking-wider text-white uppercase">
          Hidden by a moderator. Only you{loaderData.isAdmin ? " and mods" : ""} can see this.
        </p>
      )}

      {search.get("new") === "1" && isOwner && (
        <section className="border-b-2 border-ink bg-slop text-slop-ink">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5">
            <p className="font-bold">It's on the wall. Now tell people. Anything not auto-posted is one tap away:</p>
            <div className="flex flex-wrap gap-2">
              {(["x", "linkedin", "bluesky", "threads"] as const).map((network) => (
                <a key={network} className="btn btn-sm" href={intents[network]} target="_blank" rel="noopener">
                  {network === "x" ? "Post on X" : network[0].toUpperCase() + network.slice(1)}
                </a>
              ))}
            </div>
          </div>
        </section>
      )}

      <article className="mx-auto max-w-6xl px-4 pt-10">
        <nav className="eyebrow" aria-label="Breadcrumb">
          <Link to={`/@${owner.username}`} className="hover:text-ink">
            @{owner.username}
          </Link>{" "}
          / {slop.slug}
        </nav>

        <header className="stuck mt-6 px-5 pt-5 pb-6 sm:px-8">
          <div className="tape" aria-hidden="true" />
          <div className="flex flex-wrap items-center justify-between gap-2 font-mono text-[0.68rem] tracking-wider uppercase">
            <span className="font-bold">Slop {numberLabel(slop)}</span>
            <span className="text-muted">
              {day ? `${day} · ` : ""}Launched {formatDay(slop.launchDate)}
            </span>
          </div>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <h1 className="font-wide text-[clamp(2.2rem,6vw,4.2rem)] leading-[0.95] font-black tracking-tight">
                {slop.name}
                {slop.launchLabel && (
                  <span className="ml-3 inline-block -translate-y-2 align-middle text-base">
                    <span className="chip chip-beta px-3 py-1 text-xs">🚀 {slop.launchLabel}</span>
                  </span>
                )}
              </h1>
              <p className="mt-3 max-w-2xl text-lg text-muted sm:text-xl">{slop.tagline}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {slop.slopcessfulAt && <SlopcessfulChip />}
                {slop.slopOfTheDay && <SlopOfTheDayChip date={slop.slopOfTheDay} />}
                <PlatformChips links={slop.links} />
                {slop.nsfw && <span className="chip chip-nsfw">NSFW</span>}
                <CategoryChip category={slop.category} />
                {slop.madeWith.map((tag) => (
                  <span key={tag} className="chip border-line text-muted">
                    {tag}
                  </span>
                ))}
              </div>
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
                <a href={primary.url} target="_blank" rel="noopener" className="btn btn-slop">
                  {LINK_KINDS[primary.kind].beta ? "Join the beta" : "Try it"} ↗
                </a>
              )}
            </div>
          </div>
          {slop.slopcessfulAt && slop.slopcessfulNote && (
            <p className="mt-6 rounded-xl border-2 border-ink bg-gold px-4 py-3 font-bold text-[#151513]">
              ★ Slopcessful: {slop.slopcessfulNote}
            </p>
          )}
        </header>

        {slop.screenshots.length > 0 && (
          <section className="relative mt-8" aria-label="Screenshots">
            <div className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto px-4 pb-4">
              {slop.screenshots.map((id, index) => (
                <a
                  key={id}
                  href={reveal ? mediaUrl(id) : "?reveal=1"}
                  target={reveal ? "_blank" : undefined}
                  rel="noopener"
                  className="relative shrink-0 snap-start overflow-hidden rounded-xl border-2 border-ink bg-wall-deep hard-shadow-sm"
                >
                  <img
                    src={mediaUrl(id)}
                    alt={`${slop.name} screenshot ${index + 1}`}
                    loading={index === 0 ? "eager" : "lazy"}
                    className={`h-64 w-auto max-w-[85vw] object-contain sm:h-80 ${reveal ? "" : "scale-110 blur-2xl"}`}
                  />
                </a>
              ))}
            </div>
            {!reveal && (
              <div className="absolute inset-0 grid place-items-center">
                <a href="?reveal=1" className="btn btn-slop">
                  NSFW · show anyway
                </a>
              </div>
            )}
          </section>
        )}

        <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0">
            {slop.description && (
              <section aria-labelledby="about">
                <h2 id="about" className="eyebrow">
                  About
                </h2>
                <Markdown html={loaderData.descriptionHtml} className="mt-3 text-[1.05rem]" />
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

type LoaderData = Route.ComponentProps["loaderData"];

function LaunchHistory({ loaderData }: { loaderData: LoaderData }) {
  return (
    <section className="mt-12" aria-labelledby="launches-title">
      <h2 id="launches-title" className="font-wide text-2xl font-black">
        Launches
      </h2>
      <p className="mt-1 text-sm text-muted">Every launch of {loaderData.slop.name} races on its own day.</p>
      <ol className="mt-5 grid gap-2">
        {loaderData.launches.map((launch) => {
          const current = launch.id === loaderData.slop.id;
          return (
            <li key={launch.id}>
              <Link
                to={launch.path}
                aria-current={current ? "page" : undefined}
                className={`flex flex-wrap items-center gap-3 rounded-xl border-2 border-ink px-4 py-3 text-sm ${
                  current ? "bg-ink text-wall" : "bg-card hover:bg-wall-deep"
                }`}
              >
                <span className="font-mono text-xs opacity-70">#{String(launch.number).padStart(4, "0")}</span>
                <span className="font-black">{launch.title}</span>
                <span className="opacity-70">{formatDay(launch.launchDate)}</span>
                {launch.slopOfTheDay && <span>🏆</span>}
                <span className="ml-auto font-mono text-xs">▲ {launch.upvotes}</span>
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
    <section id="updates" className="mt-12 scroll-mt-24" aria-labelledby="updates-title">
      <div className="flex items-end justify-between">
        <h2 id="updates-title" className="font-wide text-2xl font-black">
          Updates
        </h2>
        <span className="font-mono text-xs text-muted">{updates.length}</span>
      </div>
      {isOwner && (
        <div className="mt-5 grid gap-3">
          <AgentPrompt prompt={(origin) => updatePrompt(origin, loaderData.slop.slug)} />
          <UpdateComposer autopostCount={loaderData.autopostCount} />
        </div>
      )}
      <ol className="mt-6 border-l-2 border-dashed border-ink/30 pl-6">
        {updates.map((update) => (
          <li key={update.id} id={`update-${update.id}`} className="relative mb-8 scroll-mt-24">
            <span
              aria-hidden="true"
              className={`absolute top-1 -left-[33px] size-4 rounded-full border-2 border-ink ${UPDATE_KIND_STYLES[update.kind]}`}
            />
            <p className="flex flex-wrap items-center gap-2 font-mono text-[0.68rem] tracking-wider uppercase">
              <span className="font-bold">{UPDATE_KINDS[update.kind].label}</span>
              <span className="text-muted">· {timeAgo(update.createdAt)}</span>
            </p>
            {update.html && <Markdown html={update.html} className="mt-2" />}
            {isOwner && update.crossposts.length > 0 && <CrosspostReceipts update={update} />}
            {isOwner && update.kind !== "launch" && (
              <Form method="post" className="mt-2">
                <input type="hidden" name="intent" value="delete-update" />
                <input type="hidden" name="id" value={update.id} />
                <button type="submit" className="text-xs text-muted underline hover:text-hot">
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
    <Form method="post" className="mt-5 rounded-2xl border-2 border-ink bg-card p-4 sm:p-5">
      <input type="hidden" name="intent" value="update" />
      <fieldset className="flex flex-wrap gap-2">
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
            <span className="chip px-3 py-1 peer-checked:bg-ink peer-checked:text-wall peer-focus-visible:outline-2">
              {UPDATE_KINDS[option].label}
            </span>
          </label>
        ))}
      </fieldset>
      {kind === "field" && (
        <p className="mt-3 text-sm text-muted">
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
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="autopost" defaultChecked className="size-4 accent-[var(--slop-deep)]" />
            Auto-post ({autopostCount} account{autopostCount === 1 ? "" : "s"})
          </label>
        ) : (
          <Link to="/settings/autopost" className="text-sm text-muted underline">
            Connect X, LinkedIn or Bluesky
          </Link>
        )}
        <button type="submit" className="btn btn-slop btn-sm">
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
    <section className="rounded-2xl border-2 border-ink bg-[#5ec8ff] p-5 text-[#151513]">
      <h2 className="font-mono text-[0.6875rem] tracking-[0.08em] uppercase">Go outside</h2>
      <p className="mt-2 font-black">Slop gets better when real people touch it. Today, try one:</p>
      <ul className="mt-3 grid list-disc gap-1.5 pl-5 text-sm">
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
    <section id="feedback" className="mt-6 scroll-mt-24" aria-labelledby="feedback-title">
      <h2 id="feedback-title" className="font-wide text-2xl font-black">
        Feedback
      </h2>
      <ol className="mt-5 grid gap-3">
        {comments.length === 0 && (
          <li className="rounded-xl border-2 border-dashed border-ink/40 p-5 text-sm text-muted">
            Nothing yet. Tried it? Say what worked, what broke, or just tell them it's good.
          </li>
        )}
        {comments.map((comment) => (
          <li
            key={comment.id}
            id={`comment-${comment.id}`}
            className={`scroll-mt-24 rounded-xl border-2 border-ink p-4 ${
              comment.kind === "kudos" ? "bg-slop text-slop-ink" : "bg-card"
            }`}
          >
            <div className="flex items-center gap-2 text-sm">
              {comment.author && <Avatar user={comment.author} size="xs" />}
              {comment.author ? (
                <Link to={`/@${comment.author.username}`} className="font-bold hover:underline">
                  @{comment.author.username}
                </Link>
              ) : (
                <span className="font-bold">Deleted account</span>
              )}
              {comment.kind === "kudos" && <span className="chip border-slop-ink">🔥 This is good</span>}
              <span className="ml-auto font-mono text-[0.65rem] opacity-70">{timeAgo(comment.createdAt)}</span>
            </div>
            <Markdown html={comment.html} className="mt-2 text-sm" />
            {comment.canDelete && (
              <Form method="post" className="mt-1 text-right">
                <input type="hidden" name="intent" value="delete-comment" />
                <input type="hidden" name="id" value={comment.id} />
                <button type="submit" className="text-xs underline opacity-70 hover:opacity-100">
                  Delete
                </button>
              </Form>
            )}
          </li>
        ))}
      </ol>
      {loaderData.signedIn ? (
        <Form method="post" className="mt-5 rounded-2xl border-2 border-ink bg-card p-4">
          <input type="hidden" name="intent" value="comment" />
          <label htmlFor="comment-body" className="sr-only">
            Your feedback
          </label>
          <textarea
            id="comment-body"
            name="body"
            required
            maxLength={LIMITS.commentLength}
            className="input min-h-24"
            placeholder="What worked? What broke? What should it do next?"
          />
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            <button type="submit" name="kind" value="kudos" className="btn btn-sm">
              🔥 This is good
            </button>
            <button type="submit" name="kind" value="feedback" className="btn btn-slop btn-sm">
              Leave feedback
            </button>
          </div>
        </Form>
      ) : (
        <Link to={`/login?returnTo=${encodeURIComponent(`${path}#feedback`)}`} className="btn mt-5">
          Sign in to leave feedback
        </Link>
      )}
    </section>
  );
}

function Sidebar({ loaderData, path }: { loaderData: LoaderData; path: string }) {
  const { owner, slop, isOwner, signedIn } = loaderData;
  return (
    <aside className="grid content-start gap-6 lg:sticky lg:top-24 lg:self-start">
      <section className="rounded-2xl border-2 border-ink bg-card p-5">
        <h2 className="eyebrow">Made by</h2>
        <Link to={`/@${owner.username}`} className="mt-3 flex items-center gap-3 hover:underline">
          <Avatar user={owner} size="md" />
          <span>
            <span className="block font-black">{owner.displayName}</span>
            <span className="block font-mono text-xs text-muted">@{owner.username}</span>
          </span>
        </Link>
        <div className="mt-4 grid gap-2">
          {slop.links.map((link) => (
            <a
              key={link.url}
              href={link.url}
              target="_blank"
              rel="noopener"
              className="flex items-center justify-between gap-3 rounded-lg border-2 border-ink px-3 py-2 text-sm font-bold hover:bg-wall-deep"
            >
              <span>{LINK_KINDS[link.kind].label}</span>
              <span className="truncate font-mono text-[0.65rem] font-normal text-muted">
                {new URL(link.url).hostname}
              </span>
            </a>
          ))}
        </div>
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
          today={loaderData.money.today}
        />
      ) : (
        loaderData.money.isPublic && <MoneySummary totals={loaderData.money.totals} />
      )}

      {isOwner && <GoOutside path={path} />}

      {isOwner && (
        <section id="slopcessful" className="scroll-mt-24 rounded-2xl border-2 border-ink bg-card p-5">
          <h2 className="eyebrow">Slopcessful?</h2>
          {slop.slopcessfulAt ? (
            <Form method="post" className="mt-3">
              <input type="hidden" name="intent" value="unslopcessful" />
              <p className="text-sm">Marked {formatDay(slop.slopcessfulAt.slice(0, 10))}.</p>
              <button type="submit" className="mt-2 text-xs text-muted underline">
                Remove the badge
              </button>
            </Form>
          ) : (
            <Form method="post" className="mt-3 grid gap-2">
              <input type="hidden" name="intent" value="slopcessful" />
              <p className="text-sm text-muted">Did this one break out? Users, revenue, a post that blew up?</p>
              <input
                name="note"
                className="input text-sm"
                required
                maxLength={LIMITS.slopcessfulNoteLength}
                placeholder="10k users in a week"
                aria-label="What happened"
              />
              {loaderData.autopostCount > 0 && (
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="autopost" defaultChecked className="size-4 accent-[var(--slop-deep)]" />
                  Auto-post it
                </label>
              )}
              <button type="submit" className="btn btn-gold btn-sm">
                ★ Mark slopcessful
              </button>
            </Form>
          )}
        </section>
      )}

      {isOwner && (
        <section className="rounded-2xl border-2 border-ink bg-card p-5">
          <h2 className="eyebrow">Your slop</h2>
          <div className="mt-3 grid gap-2">
            <Link to={`/new?from=${slop.id}`} className="btn btn-slop btn-sm">
              🚀 Launch again
            </Link>
            <Link to={`${path}/edit`} className="btn btn-sm">
              Edit details
            </Link>
            <Link to={`${path}/edit#autopost`} className="btn btn-sm">
              Auto-post for this slop
            </Link>
            <a href={`/api/slops/${slop.id}`} className="btn btn-quiet btn-sm">
              JSON
            </a>
          </div>
        </section>
      )}

      {loaderData.isAdmin && (
        <Form method="post" className="rounded-2xl border-2 border-hot p-5">
          <h2 className="eyebrow text-hot">Moderation</h2>
          <input type="hidden" name="intent" value={slop.hidden ? "unhide" : "hide"} />
          <button type="submit" className="btn btn-sm mt-3">
            {slop.hidden ? "Unhide" : "Hide from Slopper"}
          </button>
        </Form>
      )}

      {signedIn && !isOwner && (
        <details className="rounded-2xl border-2 border-dashed border-ink/40 p-4 text-sm">
          <summary className="cursor-pointer font-bold">Report this slop</summary>
          <Form method="post" className="mt-3 grid gap-2">
            <input type="hidden" name="intent" value="report" />
            <textarea
              name="reason"
              className="input min-h-20 text-sm"
              maxLength={500}
              placeholder="Untagged adult content, spam, something illegal…"
              required
            />
            <button type="submit" className="btn btn-sm">
              Send report
            </button>
          </Form>
        </details>
      )}
    </aside>
  );
}
