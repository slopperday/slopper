import { Link } from "react-router";
import type { Route } from "./+types/wall";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { CATEGORIES, type CategoryId, findCategory } from "~/lib/model";
import { seo } from "~/lib/seo";
import { SlopGrid } from "~/components/SlopCard";
import { EmptyState } from "~/components/Shared";

type Sort = "new" | "hot";

function wallHref(category: CategoryId | undefined, sort: Sort, cursor?: string) {
  const params = new URLSearchParams();
  if (category) params.set("category", category);
  if (sort !== "new") params.set("sort", sort);
  if (cursor) params.set("cursor", cursor);
  const query = params.toString();
  return query ? `/wall?${query}` : "/wall";
}

export async function loader({ request, context }: Route.LoaderArgs) {
  const asUser = context.get(viewerContext).user?._id;
  const search = new URL(request.url).searchParams;
  const category = findCategory(search.get("category") ?? "")?.id;
  const sort: Sort = search.get("sort") === "hot" ? "hot" : "new";
  const cursor = search.get("cursor");

  if (sort === "hot") {
    const since = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 14 * 86_400_000;
    const items = await convex.query(api.slops.hot, { since, category, limit: 48, asUser });
    return { category, sort, items, cursor: null };
  }
  const page = await convex.query(api.slops.recent, { category, cursor, limit: 24, asUser });
  return { category, sort, items: page.items, cursor: page.cursor };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const category = loaderData?.category ? findCategory(loaderData.category) : undefined;
  return seo(matches, {
    title: category ? `${category.label} slop` : "The wall",
    description: "Everything thrown at the wall on Slopper, freshest first.",
    path: wallHref(loaderData?.category, loaderData?.sort ?? "new"),
  });
};

export default function Wall({ loaderData }: Route.ComponentProps) {
  const current = loaderData.category ? findCategory(loaderData.category) : undefined;
  return (
    <section className="mx-auto max-w-6xl px-4 py-12">
      <p className="eyebrow">Everything that's been thrown</p>
      <h1 className="font-wide mt-2 text-4xl font-black sm:text-5xl">
        {current ? `${current.emoji} ${current.label}` : "The wall"}
      </h1>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        <Link
          to={wallHref(undefined, loaderData.sort)}
          className={`chip px-3 py-1.5 ${current ? "hover:bg-wall-deep" : "bg-ink text-wall"}`}
        >
          All
        </Link>
        {CATEGORIES.map((category) => (
          <Link
            key={category.id}
            to={wallHref(category.id, loaderData.sort)}
            className={`chip px-3 py-1.5 ${current?.id === category.id ? "bg-ink text-wall" : "hover:bg-wall-deep"}`}
          >
            <span aria-hidden="true">{category.emoji}</span> {category.label}
          </Link>
        ))}
      </div>
      <div className="mt-4 flex gap-3 font-mono text-xs tracking-wider uppercase">
        <span className="text-muted">Sort:</span>
        {(["new", "hot"] as const).map((sort) => (
          <Link
            key={sort}
            to={wallHref(loaderData.category, sort)}
            aria-current={loaderData.sort === sort ? "true" : undefined}
            className={
              loaderData.sort === sort
                ? "font-bold underline decoration-slop-deep decoration-2"
                : "text-muted hover:text-ink"
            }
          >
            {sort === "new" ? "Freshest" : "Sticking"}
          </Link>
        ))}
      </div>
      <div className="mt-12">
        {loaderData.items.length > 0 ? (
          <SlopGrid items={loaderData.items} />
        ) : (
          <EmptyState>Nothing on this part of the wall yet.</EmptyState>
        )}
      </div>
      {loaderData.cursor && (
        <div className="mt-12 text-center">
          <Link to={wallHref(loaderData.category, loaderData.sort, loaderData.cursor)} className="btn">
            Older slop →
          </Link>
        </div>
      )}
    </section>
  );
}
