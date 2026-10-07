import { Link } from "react-router";
import { dayLabel, launchTitle, slopPath } from "~/lib/display";
import type { CardItem } from "./SlopList";

/** The latest launches in one quiet line, like the next departures. Scrolls sideways when it runs out of room. */
export function JustSlopped({ items }: { items: CardItem[] }) {
  return (
    <section aria-label="Latest slops" className="border-y border-line">
      <div className="scrollbar-none mx-auto flex max-w-6xl items-center gap-8 overflow-x-auto px-4 py-3.5">
        <p className="caps flex shrink-0 items-center gap-2 text-ink">
          <span aria-hidden="true" className="size-2 rounded-full bg-slop" />
          Just slopped
        </p>
        <ul className="flex gap-8 whitespace-nowrap">
          {items.map(({ slop, owner }) => {
            const day = dayLabel(slop);
            return (
              <li key={slop.id}>
                <Link
                  to={slopPath(owner.username, slop.slug)}
                  className="group -my-2.5 inline-flex items-baseline gap-2 py-2.5"
                >
                  <span className="font-bold group-hover:underline">{launchTitle(slop)}</span>
                  <span className="text-sm text-muted">
                    @{owner.username}
                    {day ? ` · ${day}` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
