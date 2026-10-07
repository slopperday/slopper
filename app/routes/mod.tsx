import { Form, Link } from "react-router";
import type { Route } from "./+types/mod";
import { api } from "@convex/_generated/api";
import { requireUser, viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { formText } from "~/.server/forms";
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
  return { items: await convex.query(api.moderation.queue, {}) };
}

export async function action({ request, context }: Route.ActionArgs) {
  const viewer = context.get(viewerContext);
  requireUser(viewer, request);
  if (!viewer.isAdmin) notFound();
  const form = await request.formData();
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
  const { items } = loaderData;
  return (
    <section className="mx-auto max-w-4xl px-4 py-12">
      <p className="eyebrow">Moderators</p>
      <h1 className="font-wide mt-2 text-4xl font-black">Flag queue</h1>
      <p className="mt-2 max-w-2xl text-muted">
        Flagged slops stop auto-posting straight away. Three flags from different people, or a mature verdict from the
        content check, blur them; a blocked verdict hides them. Each decision clears the flags.
      </p>
      <div className="mt-8 grid gap-4">
        {items.length === 0 && <EmptyState>Nothing flagged. The wall is clean.</EmptyState>}
        {items.map((item) => (
          <article key={item.id} className="stuck p-5" aria-labelledby={`flagged-${item.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 id={`flagged-${item.id}`} className="text-xl font-black">
                  <Link to={`${slopPath(item.owner, item.slug)}?reveal=1`} className="hover:underline">
                    {item.name}
                  </Link>
                </h2>
                <p className="text-sm text-muted">
                  @{item.owner} · {item.tagline}
                </p>
              </div>
              <p className="flex gap-1.5">
                {item.hidden && <span className="chip chip-nsfw">Hidden</span>}
                {item.nsfw && <span className="chip chip-nsfw">NSFW</span>}
              </p>
            </div>
            <ul className="mt-4 grid gap-1.5 text-sm">
              {item.flags.map((flag) => (
                <li key={flag.id} className="rounded-lg border-2 border-ink/20 px-3 py-2">
                  <span className="font-bold">{flag.by ? `@${flag.by}` : "Content check"}</span>
                  <span className="ml-2 font-mono text-[0.65rem] text-muted">{timeAgo(flag.at)}</span>
                  <span className="block">{flag.reason}</span>
                </li>
              ))}
            </ul>
            <Form method="post" className="mt-4 flex flex-wrap gap-2">
              <input type="hidden" name="id" value={item.id} />
              {(Object.keys(DECISIONS) as Decision[]).map((decision) => (
                <button
                  key={decision}
                  type="submit"
                  name="decision"
                  value={decision}
                  className={`btn btn-sm ${decision === "fine" ? "btn-slop" : ""}`}
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
