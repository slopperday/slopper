import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { CATEGORIES, type CategoryId, categoryIds } from "~/lib/model";
import { normalizeQuery, SEARCH_QUERY_LENGTH } from "~/lib/search";
import { wallHref, type WallView } from "~/lib/wall";
import { Icon } from "./Icon";

const EVERY_CATEGORY = CATEGORIES.map((category) => category.id);

/**
 * The wall's search box and category chips. They're one GET form, so both
 * work without JavaScript (the chips apply with the Search button). With
 * it, a chip applies as soon as it's toggled, and shows it before the page
 * catches up.
 */
export function WallFilters({ view }: { view: WallView }) {
  const navigate = useNavigate();

  // Chips and the box change the moment they're used, and follow the URL when it changes (Back, a shared link).
  const [loaded, setLoaded] = useState(() => wallHref(view));
  const [categories, setCategories] = useState(view.categories);
  const [text, setText] = useState(view.query);
  if (loaded !== wallHref(view)) {
    setLoaded(wallHref(view));
    setCategories(view.categories);
    setText(view.query);
  }
  const picked = new Set<CategoryId>(categories);

  function show(next: CategoryId[]) {
    setCategories(next);
    // Navigation errors land in the route's error boundary, not here.
    void navigate(wallHref({ ...view, categories: next, query: normalizeQuery(text) }), { preventScrollReset: true });
  }

  function toggle(id: CategoryId) {
    show(categoryIds(picked.has(id) ? [...picked].filter((other) => other !== id) : [...picked, id]));
  }

  return (
    <form
      method="get"
      action="/wall"
      role="search"
      aria-label="Search the wall"
      className="mt-10"
      onSubmit={(event) => {
        event.preventDefault();
        show([...picked]);
      }}
    >
      {view.sort !== "new" && <input type="hidden" name="sort" value={view.sort} />}
      <div className="flex gap-2">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-faint"
          />
          <input
            type="search"
            name="q"
            value={text}
            onChange={(event) => setText(event.target.value)}
            aria-label="Search slops"
            placeholder="Search by name, or by what it does"
            maxLength={SEARCH_QUERY_LENGTH}
            enterKeyHint="search"
            className="input pl-11"
          />
        </div>
        <button type="submit" className="btn btn-ink">
          Search
        </button>
      </div>

      <div role="group" aria-labelledby="wall-categories" className="mt-6">
        <div className="flex items-baseline justify-between gap-4">
          <p id="wall-categories" className="caps">
            Categories
          </p>
          <p className="flex gap-4 text-[0.9375rem] font-bold text-muted">
            <Link
              to={wallHref({ ...view, categories: EVERY_CATEGORY })}
              onClick={() => setCategories(EVERY_CATEGORY)}
              preventScrollReset
              className="hover:text-ink"
            >
              Select all
            </Link>
            <Link
              to={wallHref({ ...view, categories: [] })}
              onClick={() => setCategories([])}
              preventScrollReset
              className="hover:text-ink"
            >
              Clear
            </Link>
          </p>
        </div>
        <div className="scrollbar-none -mx-4 mt-2 flex gap-2 overflow-x-auto px-4 py-1.5 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          {CATEGORIES.map((category) => (
            <label key={category.id} className="chip">
              <input
                type="checkbox"
                name="category"
                value={category.id}
                checked={picked.has(category.id)}
                onChange={() => toggle(category.id)}
              />
              <span className="chip-face">
                <Icon name="check" className="chip-check size-4" />
                <span className="chip-emoji" aria-hidden="true">
                  {category.emoji}
                </span>
                {category.label}
              </span>
            </label>
          ))}
        </div>
      </div>
    </form>
  );
}
