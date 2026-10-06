import { Link } from "react-router";
import type { Route } from "./+types/wall";
import { getKv } from "~/.server/kv";
import { viewerContext } from "~/.server/session";
import { listRecentSlops, listSlopsSince } from "~/.server/db/slops";
import { toFeedItems } from "~/.server/feed";
import { memo } from "~/.server/memo";
import { rankHot } from "~/lib/ranking";
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
  const kv = await getKv();
  const viewer = context.get(viewerContext).user;
  const search = new URL(request.url).searchParams;
  const category = findCategory(search.get("category") ?? "")?.id;
  const sort: Sort = search.get("sort") === "hot" ? "hot" : "new";
  const cursor = search.get("cursor") ?? undefined;

  if (sort === "hot") {
    const slops = await memo("wall:hot", 15_000, () => listSlopsSince(kv, new Date(Date.now() - 14 * 86_400_000), 400));
    const filtered = category ? slops.filter((slop) => slop.category === category) : slops;
    return {
      category,
      sort,
      items: await toFeedItems(kv, rankHot(filtered, new Date()).slice(0, 48), viewer),
      cursor: null,
    };
  }
  const page = await memo(`wall:new:${category ?? "all"}:${cursor ?? ""}`, 15_000, () =>
    listRecentSlops(kv, { category, cursor, limit: 24 }),
  );
  return { category, sort, items: await toFeedItems(kv, page.items, viewer), cursor: page.cursor };
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
