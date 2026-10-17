import { Form, Link } from "react-router";
import type { Route } from "./+types/mod";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { formText } from "~/.server/forms";
import { deleteOrphanedMedia } from "~/.server/media";
import { badRequest, notFound, redirectWithFlash } from "~/.server/http";
import { timeAgo } from "~/lib/dates";
import { slopPath } from "~/lib/display";
import { seo } from "~/lib/seo";
import { EmptyState } from "~/components/Shared";

/** The flag queue: everything people or the content check flagged, for moderators. */

const DECISIONS = {
  fine: { label: "Looks fine", message: "Cleared. It's back to normal." },
  nsfw: { label: "Keep it blurred", message: "Kept up, blurred as NSFW." },
  hide: { label: "Hide it", message: "Hidden from Slopper." },
} as const;

type Decision = keyof typeof DECISIONS;

function isDecision(value: string): value is Decision {
  return Object.hasOwn(DECISIONS, value);
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const viewer = context.get(viewerContext);
  requireUser(viewer, request);
  // Not a 403: nobody else needs to know this page exists.
  if (!viewer.isAdmin) notFound();
  const [items, videos] = await Promise.all([
    convex.query(api.moderation.queue, {}),
    convex.query(api.videos.queue, {}),
  ]);
  return { items, videos };
}

export async function action({ request, context }: Route.ActionArgs) {
  const viewer = context.get(viewerContext);
  requireUser(viewer, request);
  if (!viewer.isAdmin) notFound();
  const form = await request.formData();
  const video = formText(form, "video");
  if (video === "approve" || video === "remove") {
    const slopId = formText(form, "id");
    const item = (await convex.query(api.videos.queue, {})).find((entry) => entry.slopId === slopId);
    if (!item) return redirectWithFlash("/mod", { tone: "info", message: "Already handled." });
    const result = await convex.mutation(api.videos.decide, { slopId: item.slopId, approve: video === "approve" });
    if (result.orphaned > 0) await deleteOrphanedMedia();
    const message = video === "approve" ? "its video plays for everyone now." : "its video is gone.";
    return redirectWithFlash("/mod", { tone: "success", message: `${item.name}: ${message}` });
  }
  const decision = formText(form, "decision");
  if (!isDecision(decision)) badRequest("Unknown decision");
  const slopId = formText(form, "id");
  const item = (await convex.query(api.moderation.queue, {})).find((entry) => entry.id === slopId);
  if (!item) return redirectWithFlash("/mod", { tone: "info", message: "Already handled." });
  await convex.mutation(api.moderation.decide, { slopId: item.id, decision });
  return redirectWithFlash("/mod", { tone: "success", message: `${item.name}: ${DECISIONS[decision].message}` });
}

export const meta: Route.MetaFunction = ({ matches }) => seo(matches, { title: "Flag queue", noindex: true });

export default function Moderation({ loaderData }: Route.ComponentProps) {
  const { items, videos } = loaderData;
  return (
    <section className="mx-auto max-w-4xl px-4 pt-14">
      <h1 className="title-1">Flag queue</h1>
      <p className="lede mt-4 max-w-2xl">
        Flagged slops stop auto-posting straight away. Three flags from different people, or a mature verdict from the
        content check, blur them; a blocked verdict hides them. Each decision clears the flags.
      </p>
      {videos.length > 0 && (
        <section className="mt-12" aria-labelledby="videos-title">
          <h2 id="videos-title" className="title-2">
            Videos to review
          </h2>
          <p className="mt-2 max-w-2xl text-muted">
            The content check can't watch video, so each one waits here. Approve it and it plays on its slop for
            everyone.
          </p>
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
                </p>
                <video
                  src={video.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="mt-4 max-h-[60vh] w-full rounded-xl bg-board"
                />
                <Form method="post" className="mt-5 flex flex-wrap gap-2">
                  <input type="hidden" name="id" value={video.slopId} />
                  <button type="submit" name="video" value="approve" className="btn btn-sm btn-slop">
                    Approve video
                  </button>
                  <button type="submit" name="video" value="remove" className="btn btn-sm bg-raised">
                    Take it off
                  </button>
                </Form>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="mt-12 grid gap-4">
        {items.length === 0 && <EmptyState>Nothing flagged. The wall is clean.</EmptyState>}
        {items.map((item) => (
          <article key={item.id} className="panel sm:p-6" aria-labelledby={`flagged-${item.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id={`flagged-${item.id}`} className="font-display text-[1.75rem] leading-none font-extrabold">
                  <Link to={`${slopPath(item.owner, item.slug)}?reveal=1`} className="hover:underline">
                    {item.name}
                  </Link>
                </h2>
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
        ))}
      </div>
    </section>
  );
}
