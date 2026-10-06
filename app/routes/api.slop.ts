import type { Route } from "./+types/api.slop";
import { getKv } from "~/.server/kv";
import { getSlop } from "~/.server/db/slops";
import { getUser } from "~/.server/db/users";
import { absoluteUrl } from "~/.server/config";
import { notFound } from "~/.server/http";
import { findCategory } from "~/lib/model";
import { mediaUrl, slopPath } from "~/lib/display";

/** Public, read-only JSON for a slop. Promo video tooling reads this. */
export async function loader({ params }: Route.LoaderArgs) {
  const kv = await getKv();
  const slop = await getSlop(kv, params.id);
  if (!slop || slop.hidden) notFound();
  const owner = await getUser(kv, slop.userId);
  if (!owner) notFound();
  return Response.json(
    {
      id: slop.id,
      number: slop.number,
      name: slop.name,
      tagline: slop.tagline,
      description: slop.description,
      category: findCategory(slop.category)?.label ?? slop.category,
      nsfw: slop.nsfw,
      url: absoluteUrl(slopPath(owner.username, slop.slug)),
      links: slop.links,
      screenshots: slop.screenshots.map((id) => absoluteUrl(mediaUrl(id))),
      madeWith: slop.madeWith,
      launchDate: slop.launchDate,
      goalDay: slop.goalDay,
      goalLength: slop.goalLength,
      upvotes: slop.upvotes,
      slopcessful: slop.slopcessfulAt ? { at: slop.slopcessfulAt, note: slop.slopcessfulNote } : null,
      owner: { username: owner.username, displayName: owner.displayName, avatarUrl: owner.avatarUrl },
    },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" } },
  );
}
