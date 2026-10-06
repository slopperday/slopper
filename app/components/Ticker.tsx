import { Link } from "react-router";
import { dayLabel, slopPath } from "~/lib/display";
import type { CardItem } from "./SlopCard";

/** "Just slopped" ticker of the latest launches, doubled for a seamless loop. */
export function Ticker({ items }: { items: CardItem[] }) {
  const entries = (copy: string) =>
    items.map(({ slop, owner }) => (
      <Link
        key={`${copy}-${slop.id}`}
        to={slopPath(owner.username, slop.slug)}
        tabIndex={copy === "b" ? -1 : undefined}
        className="inline-flex items-center gap-2 px-5 hover:text-slop"
      >
        <span className="text-slop" aria-hidden="true">
          ●
        </span>
        <span className="font-bold">@{owner.username}</span>
        <span className="opacity-60">slopped</span>
        <span className="font-bold">{slop.name}</span>
        {dayLabel(slop) && <span className="opacity-60">({dayLabel(slop)})</span>}
      </Link>
    ));
  return (
    <div
      className="ticker overflow-hidden border-b-2 border-ink bg-ink py-2.5 font-mono text-xs tracking-wider text-wall uppercase"
      aria-label="Latest slops"
    >
      <div className="ticker-track flex w-max whitespace-nowrap">
        <span className="inline-flex items-center px-5 font-bold text-slop">Just slopped</span>
        {entries("a")}
        <span aria-hidden="true" className="contents">
          <span className="inline-flex items-center px-5 font-bold text-slop">Just slopped</span>
          {entries("b")}
        </span>
      </div>
    </div>
  );
}
