import { Link } from "react-router";
import { findCategory, type SlopLink } from "~/lib/model";
import { platformBadges } from "~/lib/display";

/** Small pieces shared by slop cards and the slop page. */

export function PlatformChips({ links }: { links: readonly SlopLink[] }) {
  return (
    <>
      {platformBadges(links).map((badge) => (
        <span key={badge.platform} className={`chip ${badge.beta ? "chip-beta" : ""}`}>
          {badge.label}
          {badge.beta ? " beta" : ""}
        </span>
      ))}
    </>
  );
}

export function CategoryChip({ category: id }: { category: string }) {
  const category = findCategory(id);
  if (!category) return null;
  return (
    <Link to={`/wall?category=${category.id}`} className="chip relative z-10 border-line hover:border-ink">
      <span aria-hidden="true">{category.emoji}</span>
      {category.label}
    </Link>
  );
}

export function SlopcessfulChip() {
  return <span className="chip chip-gold">★ Slopcessful</span>;
}

export function SlopOfTheDayChip({ date }: { date: string }) {
  return (
    <Link to={`/day/${date}`} className="chip relative z-10 bg-ink text-wall" title={`Slop of the day, ${date}`}>
      🏆 Slop of the day
    </Link>
  );
}

/** Cover screenshot, or a lettered placeholder when there is none. */
export function SlopImage({
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
      <div className={`grid place-items-center overflow-hidden bg-wall-deep ${className}`} aria-hidden="true">
        <span className="font-display text-5xl text-ink/15 select-none">{slop.name.slice(0, 2)}</span>
      </div>
    );
  }
  return (
    <div className={`overflow-hidden bg-wall-deep ${className}`}>
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
