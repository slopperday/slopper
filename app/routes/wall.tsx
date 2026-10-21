import { Link, useNavigation } from "react-router";
import type { Route } from "./+types/wall";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { allowAction, callerAddress } from "~/.server/tokens";
import { categoryFilter, findCategory } from "~/lib/model";
import { listWords } from "~/lib/display";
import { seo } from "~/lib/seo";
import { parseCursor, parseWallView, wallHref, type WallSort, type WallView } from "~/lib/wall";
import { SlopList } from "~/components/SlopList";
import { EmptyState } from "~/components/Shared";
import { Icon } from "~/components/Icon";
import { WallFilters } from "~/components/WallFilters";

export async function loader({ request, context }: Route.LoaderArgs) {
  const viewer = context.get(viewerContext).user;
  const asUser = viewer?._id;
  const params = new URL(request.url).searchParams;
  const view = parseWallView(params);
  const { categories } = view;

  if (view.query) {
    // Searching by meaning costs an embedding model call. Signed-in people
    // get the API's own limit; a visitor's address gets the anonymous API's,
    // so crawlers can't mint paid calls at request speed.
    const limited = viewer
      ? null
      : (await allowAction(`wall-search:${callerAddress(request)}`, 120, 3_600_000))
        ? null
        : { error: "Too many searches. Try again in a while." };
    if (limited)
      throw new Response(JSON.stringify(limited), { status: 429, headers: { "content-type": "application/json" } });
    const items = await convex.action(api.search.find, { query: view.query, categories, asUser });
    return { view, items, cursor: null };
  }
  if (view.sort === "hot") {
    const since = Math.floor(Date.now() / 3_600_000) * 3_600_000 - 14 * 86_400_000;
    const items = await convex.query(api.slops.hot, { since, categories, limit: 48, asUser });
    return { view, items, cursor: null };
  }
  const page = await convex.query(api.slops.recent, { categories, before: parseCursor(params), limit: 24, asUser });
  return { view, items: page.items, cursor: page.cursor };
}

/** The picked categories' labels, or none when the wall isn't narrowed. */
function categoryLabels(view: WallView): string[] {
  return categoryFilter(view.categories).flatMap((id) => findCategory(id)?.label ?? []);
}

function heading(view: WallView): { title: string; lede: string } {
  const labels = categoryLabels(view);
  if (view.query) {
    const within = labels.length > 0 ? ` in ${listWords(labels, "or")}` : "";
    return { title: "The wall", lede: `Best matches for “${view.query}”${within}.` };
  }
  if (labels.length === 1) return { title: labels[0], lede: `Slops filed under ${labels[0]}.` };
  if (labels.length > 1) return { title: "The wall", lede: `Slops filed under ${listWords(labels, "or")}.` };
  return { title: "The wall", lede: "Everything that's been thrown." };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) => {
  const view = loaderData?.view;
  const labels = view ? categoryLabels(view) : [];
  const title = view?.query ? `“${view.query}” on the wall` : labels.length === 1 ? `${labels[0]} slop` : "The wall";
  return seo(matches, {
    title,
    description: "Everything thrown at the wall on Slopper, freshest first.",
    path: view ? wallHref(view) : "/wall",
  });
};

const SORTS: { sort: WallSort; label: string }[] = [
  { sort: "new", label: "Freshest" },
  { sort: "hot", label: "Sticking" },
];

export default function Wall({ loaderData }: Route.ComponentProps) {
  const { view, items, cursor } = loaderData;
  const { title, lede } = heading(view);
  const navigation = useNavigation();
  const loading = navigation.state === "loading" && navigation.location.pathname === "/wall";
  return (
    <section className="mx-auto max-w-6xl px-4 pt-14">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-6">
        <div>
          <h1 className="title-1">{title}</h1>
          <p className="lede mt-4">{lede}</p>
        </div>
        {/* Search results come best match first, so sorting only applies without one. */}
        {!view.query && (
          <nav aria-label="Sort" className="flex rounded-xl bg-sunk p-1">
            {SORTS.map(({ sort, label }) => (
              <Link
                key={sort}
                to={wallHref({ ...view, sort })}
                aria-current={view.sort === sort ? "true" : undefined}
                className={`flex min-h-10 items-center rounded-lg px-4 font-bold ${
                  view.sort === sort ? "bg-ink text-ground" : "text-muted hover:text-ink"
                }`}
              >
                {label}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <WallFilters view={view} />
      <div aria-busy={loading} className={`mt-12 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {items.length > 0 ? (
          <SlopList items={items} />
        ) : (
          <EmptyState>
            {view.query ? `No slop matches “${view.query}” yet.` : "Nothing on this part of the wall yet."}
          </EmptyState>
        )}
      </div>
      {cursor !== null && (
        <div className="mt-16 text-center">
          <Link to={wallHref(view, cursor)} className="btn btn-lg">
            Older slop <Icon name="right" className="size-4" />
          </Link>
        </div>
      )}
    </section>
  );
}
