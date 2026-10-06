import { Link } from "react-router";
import type { Route } from "./+types/slopcessful";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { seo } from "~/lib/seo";
import { SlopGrid } from "~/components/SlopCard";
import { Splat } from "~/components/Splat";
import { useLive } from "~/components/Live";

export async function loader({ context }: Route.LoaderArgs) {
  return { items: await convex.query(api.slops.slopcessful, { asUser: context.get(viewerContext).user?._id }) };
}

export const meta: Route.MetaFunction = ({ matches }) =>
  seo(matches, {
    title: "Slopcessful",
    description: "Slops that broke out. Every one of them started as just another day's slop.",
    path: "/slopcessful",
  });

export default function Slopcessful({ loaderData }: Route.ComponentProps) {
  const items = useLive(api.slops.slopcessful, {}, loaderData.items);
  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <div className="relative">
        <Splat seed={99} className="pointer-events-none absolute -top-10 -left-10 -z-10 size-48 text-gold/40" />
        <p className="eyebrow">Hall of fame</p>
        <h1 className="font-wide mt-2 text-4xl font-black sm:text-6xl">Slopcessful</h1>
        <p className="mt-4 max-w-2xl text-lg text-muted">
          Slops that broke out: real users, real revenue, a post that blew up. None of them looked special on launch
          day. They just kept slopping.
        </p>
      </div>
      <div className="mt-12">
        {items.length > 0 ? (
          <SlopGrid items={items} />
        ) : (
          <div className="rounded-2xl border-2 border-dashed border-ink/40 p-10 text-center">
            <p className="font-display text-4xl text-gold">Not yet.</p>
            <p className="mx-auto mt-3 max-w-md text-muted">
              Nobody has broken out. The first slopcessful slop is out there, probably a few dozen slops away.
            </p>
            <Link to="/new" className="btn btn-slop mt-6">
              Keep slopping
            </Link>
          </div>
        )}
      </div>
    </section>
  );
}
