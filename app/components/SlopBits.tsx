import { Link } from "react-router";
import { findCategory, type SlopLink } from "~/lib/model";
import { platformBadges } from "~/lib/display";
import { Icon } from "./Icon";
import { Bang } from "./Logo";

/** Small pieces shared by slop cards, race rows and the slop page. */

/** "Web · iOS beta": where you can try it, as plain words. */
export function Platforms({ links }: { links: readonly SlopLink[] }) {
  const badges = platformBadges(links);
  if (badges.length === 0) return null;
  return <span>{badges.map((badge) => `${badge.label}${badge.beta ? " beta" : ""}`).join(" · ")}</span>;
}

export function CategoryLink({ category: id }: { category: string }) {
  const category = findCategory(id);
  if (!category) return null;
  return (
    <Link to={`/wall?category=${category.id}`} className="relative z-10 -my-3 inline-block py-3 hover:underline">
      {category.label}
    </Link>
  );
}

export function LaunchLabelTag({ label }: { label: string }) {
  return <span className="tag tag-slop">🚀 {label}</span>;
}

export function SlopcessfulTag() {
  return (
    <span className="tag tag-gold">
      <Icon name="star" filled className="size-3.5 text-gold-text" />
      Slopcessful
    </span>
  );
}

export function SlopOfTheDayTag({ date }: { date: string }) {
  return (
    <Link to={`/day/${date}`} className="tag tag-gold relative z-10 hover:underline" title={`Slop of the day, ${date}`}>
      Slop of the day
    </Link>
  );
}

export function NsfwTag() {
  return <span className="tag tag-hot">NSFW</span>;
}

/**
 * The slop's cover screenshot or, with none, a shipped-day tile: the same
 * drip bang a launch flips onto the goal board.
 */
export function SlopCover({
  slop,
  className = "",
  blur = false,
}: {
  slop: { name: string; screenshots: readonly string[] };
  className?: string;
  blur?: boolean;
}) {
  const first = slop.screenshots[0];
  if (!first) {
    return (
      <div className={`tile grid place-items-center ${className}`} aria-hidden="true">
        <Bang className="h-3/5 w-auto" />
      </div>
    );
  }
  return (
    <div className={`overflow-hidden bg-sunk ${className}`}>
      <img
        src={first}
        alt={`${slop.name} screenshot`}
        loading="lazy"
        decoding="async"
        className={`size-full object-cover object-top ${blur ? "scale-110 blur-2xl" : ""}`}
      />
    </div>
  );
}
