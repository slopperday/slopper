import { Link } from "react-router";
import type { Route } from "./+types/wall";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { CATEGORIES, type CategoryId, findCategory } from "~/lib/model";
import { seo } from "~/lib/seo";
import { SlopList } from "~/components/SlopList";
import { EmptyState } from "~/components/Shared";
import { Icon } from "~/components/Icon";

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
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div>
          <h1 className="title-1">{current ? current.label : "The wall"}</h1>
          <p className="lede mt-4">
            {current ? `Slops filed under ${current.label}.` : "Everything that's been thrown."}
          </p>
        </div>
        <nav aria-label="Sort" className="flex rounded-xl bg-sunk p-1">
          {(["new", "hot"] as const).map((sort) => (
            <Link
              key={sort}
              to={wallHref(loaderData.category, sort)}
              aria-current={loaderData.sort === sort ? "true" : undefined}
              className={`flex min-h-10 items-center rounded-lg px-4 font-bold ${
                loaderData.sort === sort ? "bg-ink text-ground" : "text-muted hover:text-ink"
              }`}
            >
              {sort === "new" ? "Freshest" : "Sticking"}
            </Link>
          ))}
        </nav>
      </div>
      <nav aria-label="Categories" className="scrollbar-none mt-10 flex overflow-x-auto border-b border-line">
        {[{ id: undefined, label: "All" }, ...CATEGORIES].map((category) => {
          const active = current?.id === category.id;
          return (
            <Link
              key={category.label}
              to={wallHref(category.id, loaderData.sort)}
              aria-current={active ? "page" : undefined}
              className={`relative flex min-h-11 shrink-0 items-center px-3 font-bold whitespace-nowrap first:pl-0 after:absolute after:right-3 after:bottom-0 after:left-3 after:h-[3px] after:rounded-t-full first:after:left-0 ${
                active ? "text-ink after:bg-slop" : "text-muted hover:text-ink"
              }`}
            >
              {category.label}
            </Link>
          );
        })}
      </nav>
      <div className="mt-12">
        {loaderData.items.length > 0 ? (
          <SlopList items={loaderData.items} />
        ) : (
          <EmptyState>Nothing on this part of the wall yet.</EmptyState>
        )}
      </div>
      {loaderData.cursor && (
        <div className="mt-16 text-center">
          <Link to={wallHref(loaderData.category, loaderData.sort, loaderData.cursor)} className="btn btn-lg">
            Older slop <Icon name="right" className="size-4" />
          </Link>
        </div>
      )}
    </section>
  );
}
