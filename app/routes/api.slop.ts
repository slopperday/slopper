import type { Route } from "./+types/api.slop";
import { api } from "@convex/_generated/api";
import { convex } from "~/.server/convex";
import { absoluteUrl } from "~/.server/config";
import { notFound } from "~/.server/http";
import { findCategory } from "~/lib/model";
import { slopPath } from "~/lib/display";

/** Public, read-only JSON for one launch. Promo video tooling reads this. */
export async function loader({ params }: Route.LoaderArgs) {
  const found = await convex.query(api.slops.publicById, { id: params.id });
  if (!found) notFound();
  const { slop, owner } = found;
  return Response.json(
    {
      id: slop.id,
      number: slop.number,
      productId: slop.productId,
      launchLabel: slop.launchLabel,
      name: slop.name,
      tagline: slop.tagline,
      description: slop.description,
      category: findCategory(slop.category)?.label ?? slop.category,
      nsfw: slop.nsfw,
      url: absoluteUrl(slopPath(owner.username, slop.slug)),
      links: slop.links,
      screenshots: slop.screenshots,
      publication: slop.publication,
      madeWith: slop.madeWith,
      launchDate: slop.launchDate,
      goalDay: slop.goalDay,
      goalLength: slop.goalLength,
      upvotes: slop.upvotes,
      backers: slop.backers,
      pledgedUsdCents: slop.pledged,
      slopOfTheDay: slop.slopOfTheDay,
      slopcessful: slop.slopcessfulAt
        ? { at: new Date(slop.slopcessfulAt).toISOString(), note: slop.slopcessfulNote }
        : null,
      owner: { username: owner.username, displayName: owner.displayName, avatarUrl: owner.avatarUrl },
    },
    { headers: { "access-control-allow-origin": "*", "cache-control": "public, max-age=60" } },
  );
}
