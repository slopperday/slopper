import { type CategoryId, categoryIds } from "./model";
import { normalizeQuery } from "./search";

/**
 * What the wall shows, all of it in the URL so a view can be shared and the
 * back button walks through filters: `?q=budget&category=money&category=ai`.
 */

export type WallSort = "new" | "hot";

export interface WallView {
  /** Picked categories, in CATEGORIES order. None picked shows every category. */
  categories: CategoryId[];
  sort: WallSort;
  /** A search, ranked by relevance instead of `sort`. Empty when there's none. */
  query: string;
}

export function parseWallView(params: URLSearchParams): WallView {
  return {
    categories: categoryIds(params.getAll("category")),
    sort: params.get("sort") === "hot" ? "hot" : "new",
    query: normalizeQuery(params.get("q") ?? ""),
  };
}

/** The wall's URL for `view`; `before` is the cursor for older slops. */
export function wallHref(view: WallView, before?: number): string {
  const params = new URLSearchParams();
  if (view.query) params.set("q", view.query);
  for (const category of view.categories) params.append("category", category);
  if (view.sort !== "new") params.set("sort", view.sort);
  if (before !== undefined) params.set("cursor", String(before));
  const query = params.toString();
  return query ? `/wall?${query}` : "/wall";
}

/** The cursor from a wall URL: a slop's creation time. */
export function parseCursor(params: URLSearchParams): number | null {
  const value = Number(params.get("cursor") ?? "");
  return params.has("cursor") && Number.isFinite(value) && value > 0 ? value : null;
}
