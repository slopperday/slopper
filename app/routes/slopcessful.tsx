import { Link } from "react-router";
import type { Route } from "./+types/slopcessful";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { seo } from "~/lib/seo";
import { SlopList } from "~/components/SlopList";
import { Icon } from "~/components/Icon";
import { EmptyState } from "~/components/Shared";
import { useLive } from "~/components/Live";

export async function loader({ context }: Route.LoaderArgs) {
  return { items: await convex.query(api.slops.slopcessful, { asUser: context.get(viewerContext).user?._id }) };
}

export const meta: Route.MetaFunction = ({ matches }) =>
  seo(matches, {
    title: "Slopcessful",
    description: "Every slop of the day: the slops that won their day's race on votes.",
    path: "/slopcessful",
  });

export default function Slopcessful({ loaderData }: Route.ComponentProps) {
  const items = useLive(api.slops.slopcessful, {}, loaderData.items);
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <h1 className="title-1 flex items-center gap-3">
        <Icon name="star" filled className="size-[0.8em] text-gold" />
        Slopcessful
      </h1>
      <p className="lede mt-4">
        The hall of fame. Every slop that won its day: the most votes when the clock hit midnight UTC. Nobody can
        declare it; people vote it in.
      </p>
      <div className="mt-14">
        {items.length > 0 ? (
          <SlopList items={items} />
        ) : (
          <EmptyState>
            <p className="font-display text-[2.75rem] leading-none font-black text-ink">Not yet.</p>
            <p className="mx-auto mt-3 max-w-md">
              No day has a winner yet. The first slopcessful slop is out there, probably a few dozen slops away.
            </p>
            <Link to="/new" className="btn btn-slop mt-6">
              Keep slopping
            </Link>
          </EmptyState>
        )}
      </div>
    </section>
  );
}
