import { Form, Link } from "react-router";
import type { Route } from "./+types/mod";
import { api } from "@convex/_generated/api";
import { isAdmin } from "@convex/lib/auth";
import { requireStaff, type User, viewerContext } from "~/.server/session";
import { convex, convexMessage } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { deleteOrphanedMedia } from "~/.server/media";
import { forbidden, outOfDateForm, redirectWithFlash } from "~/.server/http";
import { timeAgo } from "~/lib/dates";
import { slopPath } from "~/lib/display";
import { seo } from "~/lib/seo";
import { EmptyState } from "~/components/Shared";

/**
 * Moderation. Moderators approve or reject what waits here: promo videos and
 * flagged slops. Admins also see what the video check decided on its own,
 * take down videos it let through, and revoke or restore trust.
 */

const DECISIONS = {
  fine: { label: "Looks fine", message: "Cleared. It's back to normal." },
  nsfw: { label: "Keep it blurred", message: "Kept up, blurred as NSFW." },
  hide: { label: "Hide it", message: "Hidden from Slopper." },
} as const;

type Decision = keyof typeof DECISIONS;

function isDecision(value: string): value is Decision {
  return Object.hasOwn(DECISIONS, value);
}

const VERDICTS = {
  ok: "Passed",
  mature: "Mature",
  blocked: "Blocked",
  unchecked: "Couldn't check",
} as const;

export async function loader({ request, context }: Route.LoaderArgs) {
  const user = requireStaff(context.get(viewerContext), request, "moderator");
  const admin = isAdmin(user);
  const [items, videos, checks, trust] = await Promise.all([
    convex.query(api.moderation.queue, {}),
    convex.query(api.videos.queue, {}),
    admin ? convex.query(api.videos.checks, {}) : [],
    admin ? convex.query(api.videos.trustList, {}) : [],
  ]);
  return { items, videos, checks, trust, admin };
}

/** Runs one decision, turning a Convex business-rule error into a flash. */
async function attempt(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    const message = convexMessage(error);
    if (message) return redirectWithFlash("/mod", { tone: "error", message });
    throw error;
  }
}

const handled = () => redirectWithFlash("/mod", { tone: "info", message: "Already handled." });

/** Approve or take off a waiting video: the one the moderator watched, never a newer one. */
async function decideVideo(user: User, form: FormData): Promise<Response> {
  const decision = formText(form, "decision");
  if (decision !== "approve" && decision !== "remove") return outOfDateForm("/mod");
  const slopId = formText(form, "id");
  const mediaId = formText(form, "media");
  const item = (await convex.query(api.videos.queue, {})).find(
    (entry) => entry.slopId === slopId && entry.mediaId === mediaId,
  );
  if (!item) return handled();
  const result = await convex.mutation(api.videos.decide, {
    moderatorId: user._id,
    slopId: item.slopId,
    mediaId: item.mediaId,
    approve: decision === "approve",
  });
  if (!result.decided) return handled();
  if (result.orphaned > 0) await deleteOrphanedMedia();
  const message =
    decision === "remove"
      ? `${item.name}: its video is gone.`
      : `${item.name}: its video plays for everyone now.${
          result.newlyTrusted ? ` @${item.owner} is trusted now.` : ""
        }`;
  return redirectWithFlash("/mod", { tone: "success", message });
}

async function decideFlag(user: User, form: FormData): Promise<Response> {
  const decision = formText(form, "decision");
  if (!isDecision(decision)) return outOfDateForm("/mod");
  const slopId = formText(form, "id");
  const item = (await convex.query(api.moderation.queue, {})).find((entry) => entry.id === slopId);
  if (!item) return handled();
  await convex.mutation(api.moderation.decide, { moderatorId: user._id, slopId: item.id, decision });
  return redirectWithFlash("/mod", { tone: "success", message: `${item.name}: ${DECISIONS[decision].message}` });
}

/** An admin takes off a video the check let through. */
async function takeDown(user: User, form: FormData): Promise<Response> {
  const slopId = formText(form, "id");
  const mediaId = formText(form, "media");
  const item = (await convex.query(api.videos.checks, {})).find(
    (entry) => entry.slopId === slopId && entry.mediaId === mediaId,
  );
  if (!item) return handled();
  const result = await convex.mutation(api.videos.takeDown, {
    adminId: user._id,
    slopId: item.slopId,
    mediaId: item.mediaId,
  });
  if (!result.removed) return handled();
  if (result.orphaned > 0) await deleteOrphanedMedia();
  return redirectWithFlash("/mod", { tone: "success", message: `${item.name}: its video is gone.` });
}

/** An admin revokes someone's trust, or gives it back. */
async function setTrust(user: User, form: FormData): Promise<Response> {
  const userId = formText(form, "user");
  const trusted = formText(form, "trusted") === "true";
  const [trust, checks] = await Promise.all([
    convex.query(api.videos.trustList, {}),
    convex.query(api.videos.checks, {}),
  ]);
  const target =
    trust.find((entry) => entry.userId === userId)?.userId ?? checks.find((entry) => entry.ownerId === userId)?.ownerId;
  if (!target) return handled();
  const username = await convex.mutation(api.videos.setTrust, { adminId: user._id, userId: target, trusted });
  const message = trusted ? `@${username} is trusted again.` : `@${username} isn't trusted any more.`;
  return redirectWithFlash("/mod", { tone: "success", message });
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = requireStaff(context.get(viewerContext), request, "moderator");
  const form = await request.formData();
  const intent = formText(form, "intent");
  return await attempt(async () => {
    switch (intent) {
      case "video":
        return await decideVideo(user, form);
      case "flag":
        return await decideFlag(user, form);
      case "takedown":
        if (!isAdmin(user)) forbidden();
        return await takeDown(user, form);
      case "trust":
        if (!isAdmin(user)) forbidden();
        return await setTrust(user, form);
      default:
        return outOfDateForm("/mod");
    }
  });
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Moderation", noindex: true });

type LoaderData = Route.ComponentProps["loaderData"];

export default function Moderation({ loaderData }: Route.ComponentProps) {
  const { items, videos, checks, trust, admin } = loaderData;
  return (
    <section className="mx-auto max-w-4xl px-4 pt-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="title-1">Moderation</h1>
        {admin && (
          <Link to="/mod/team" className="btn btn-sm bg-raised">
            Moderation team
          </Link>
        )}
      </div>
      <p className="lede mt-4 max-w-2xl">Approve or reject what waits here.</p>
      {videos.length > 0 && <VideoQueue videos={videos} />}
      <section className="mt-12" aria-labelledby="flags-title">
        <h2 id="flags-title" className="title-2">
          Flagged slops
        </h2>
        <div className="mt-6 grid gap-4">
          {items.length === 0 && <EmptyState>Nothing flagged. The wall is clean.</EmptyState>}
          {items.map((item) => (
            <FlaggedSlop key={item.id} item={item} />
          ))}
        </div>
      </section>
      {admin && checks.length > 0 && <AutomaticChecks checks={checks} />}
      {admin && trust.length > 0 && <TrustedUploaders trust={trust} />}
    </section>
  );
}

function VideoQueue({ videos }: { videos: LoaderData["videos"] }) {
  return (
    <section className="mt-12" aria-labelledby="videos-title">
      <h2 id="videos-title" className="title-2">
        Videos to review
      </h2>
      <div className="mt-6 grid gap-4">
        {videos.map((video) => (
          <article key={video.slopId} className="panel sm:p-6" aria-labelledby={`video-${video.slopId}`}>
            <h3 id={`video-${video.slopId}`} className="font-display text-[1.75rem] leading-none font-extrabold">
              <Link to={slopPath(video.owner, video.slug)} className="hover:underline">
                {video.name}
              </Link>
            </h3>
            <p className="mt-1.5 text-muted">
              @{video.owner} · sent {timeAgo(video.submittedAt)}
              {video.trust === "trusted" && " · trusted"}
              {video.trust === "revoked" && " · trust revoked"}
            </p>
            {video.check && (
              <p className="mt-3">
                <span className="tag tag-hot">Video check: {VERDICTS[video.check.verdict]}</span>{" "}
                <span className="text-muted">{video.check.reason}</span>
              </p>
            )}
            <video
              src={video.url}
              controls
              playsInline
              preload="metadata"
              className="mt-4 max-h-[60vh] w-full rounded-xl bg-board"
            />
            <Form method="post" className="mt-5 flex flex-wrap gap-2">
              <input type="hidden" name="intent" value="video" />
              <input type="hidden" name="id" value={video.slopId} />
              <input type="hidden" name="media" value={video.mediaId} />
              <button type="submit" name="decision" value="approve" className="btn btn-sm btn-slop">
                Approve video
              </button>
              <button type="submit" name="decision" value="remove" className="btn btn-sm bg-raised">
                Take it off
              </button>
            </Form>
          </article>
        ))}
      </div>
    </section>
  );
}

function FlaggedSlop({ item }: { item: LoaderData["items"][number] }) {
  return (
    <article className="panel sm:p-6" aria-labelledby={`flagged-${item.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id={`flagged-${item.id}`} className="font-display text-[1.75rem] leading-none font-extrabold">
            <Link to={`${slopPath(item.owner, item.slug)}?reveal=1`} className="hover:underline">
              {item.name}
            </Link>
          </h3>
          <p className="mt-1.5 text-muted">
            @{item.owner} · {item.tagline}
          </p>
        </div>
        <p className="flex gap-1.5">
          {item.hidden && <span className="tag tag-hot">Hidden</span>}
          {item.nsfw && <span className="tag tag-hot">NSFW</span>}
        </p>
      </div>
      <ul className="mt-5 divide-y divide-line border-y border-line">
        {item.flags.map((flag) => (
          <li key={flag.id} className="py-2.5">
            <span className="font-bold">{flag.by ? `@${flag.by}` : "Content check"}</span>
            <span className="ml-2 text-sm text-muted">{timeAgo(flag.at)}</span>
            <span className="block">{flag.reason}</span>
          </li>
        ))}
      </ul>
      <Form method="post" className="mt-5 flex flex-wrap gap-2">
        <input type="hidden" name="intent" value="flag" />
        <input type="hidden" name="id" value={item.id} />
        {(Object.keys(DECISIONS) as Decision[]).map((decision) => (
          <button
            key={decision}
            type="submit"
            name="decision"
            value={decision}
            className={`btn btn-sm ${decision === "fine" ? "btn-slop" : "bg-raised"}`}
          >
            {DECISIONS[decision].label}
          </button>
        ))}
      </Form>
    </article>
  );
}

function AutomaticChecks({ checks }: { checks: LoaderData["checks"] }) {
  return (
    <section className="mt-12" aria-labelledby="checks-title">
      <h2 id="checks-title" className="title-2">
        Checked automatically
      </h2>
      <ul className="mt-6 grid gap-4">
        {checks.map((check) => (
          <li key={check.id} className="panel sm:p-6" aria-labelledby={`check-${check.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id={`check-${check.id}`} className="font-display text-[1.5rem] leading-none font-extrabold">
                  <Link to={slopPath(check.owner, check.slug)} className="hover:underline">
                    {check.name}
                  </Link>
                </h3>
                <p className="mt-1.5 text-muted">
                  @{check.owner} · {timeAgo(check.at)}
                </p>
              </div>
              <p className="flex flex-wrap gap-1.5">
                <span className={`tag ${check.verdict === "ok" ? "tag-slop" : "tag-hot"}`}>
                  {VERDICTS[check.verdict]}
                </span>
                <span className="tag">{check.outcome === "live" ? "Went live" : "Sent to the queue"}</span>
                {check.showing === "gone" && <span className="tag">Since replaced</span>}
              </p>
            </div>
            <p className="mt-3">{check.reason}</p>
            {check.showing === "live" && check.url && (
              <video
                src={check.url}
                controls
                playsInline
                preload="none"
                className="mt-4 max-h-[40vh] w-full rounded-xl bg-board"
              />
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              {check.showing === "live" && (
                <Form method="post">
                  <input type="hidden" name="intent" value="takedown" />
                  <input type="hidden" name="id" value={check.slopId} />
                  <input type="hidden" name="media" value={check.mediaId} />
                  <button type="submit" className="btn btn-sm bg-raised">
                    Take the video down
                  </button>
                </Form>
              )}
              {check.trust === "trusted" && <TrustButton userId={check.ownerId} username={check.owner} trusted />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TrustButton({ userId, username, trusted }: { userId: string; username: string; trusted: boolean }) {
  return (
    <Form method="post">
      <input type="hidden" name="intent" value="trust" />
      <input type="hidden" name="user" value={userId} />
      <input type="hidden" name="trusted" value={trusted ? "false" : "true"} />
      <button
        type="submit"
        className="btn btn-sm bg-raised"
        aria-label={`${trusted ? "Revoke" : "Restore"} @${username}'s trust`}
      >
        {trusted ? "Revoke trust" : "Trust again"}
      </button>
    </Form>
  );
}

function TrustedUploaders({ trust }: { trust: LoaderData["trust"] }) {
  return (
    <section className="mt-12" aria-labelledby="trust-title">
      <h2 id="trust-title" className="title-2">
        Trusted makers
      </h2>
      <ul className="mt-6 divide-y divide-line border-y border-line">
        {trust.map((entry) => (
          <li key={entry.userId} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <p>
              <Link to={`/@${entry.username}`} className="font-bold hover:underline">
                @{entry.username}
              </Link>
              <span className="ml-2 text-muted">
                {entry.trusted ? "trusted" : "revoked"}
                {entry.by ? ` by @${entry.by}` : ""} {timeAgo(entry.at)}
              </span>
            </p>
            <TrustButton userId={entry.userId} username={entry.username} trusted={entry.trusted} />
          </li>
        ))}
      </ul>
    </section>
  );
}
