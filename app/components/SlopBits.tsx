import { Link } from "react-router";
import type { PublicationFormat } from "@convex/lib/media";
import { findCategory, type SlopLink } from "~/lib/model";
import { platformBadges } from "~/lib/display";
import { fixedImage, fluidImage, type ImageSource } from "~/lib/images";
import { Icon } from "./Icon";
import { Splat } from "./Logo";
import { useImageCdn } from "./useImageCdn";

/** Small pieces shared by slop cards, race rows and the slop page. */

/** "Web · iOS beta": where you can try it, as plain words. */
/** Where to try it, then "PDF" or "EPUB" when there's a publication to read. */
export function Platforms({
  links,
  publication = null,
}: {
  links: readonly SlopLink[];
  publication?: PublicationFormat | null;
}) {
  const badges = platformBadges(links).map((badge) => `${badge.label}${badge.beta ? " beta" : ""}`);
  if (publication) badges.push(publication.toUpperCase());
  if (badges.length === 0) return null;
  return <span>{badges.join(" · ")}</span>;
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
 * The slop's cover screenshot or, with none, a board tile with the seeded
 * splat. `size` is how wide it's shown: a square of that many CSS pixels,
 * or a `sizes` attribute for a cover that follows the layout. `priority`
 * loads it at once, for the cover that is the page's largest picture.
 */
export function SlopCover({
  slop,
  className = "",
  blur = false,
  size = 80,
  priority = false,
}: {
  slop: { name: string; screenshots: readonly string[] };
  className?: string;
  blur?: boolean;
  size?: number | string;
  priority?: boolean;
}) {
  const cdn = useImageCdn();
  const first = slop.screenshots[0];
  if (!first) {
    return (
      <div className={`tile grid place-items-center ${className}`} aria-hidden="true">
        <Splat tone="board" className="h-3/5 w-auto" />
      </div>
    );
  }
  // A blurred cover shows no detail, so a thumbnail does.
  const source: ImageSource = blur
    ? fixedImage(first, { w: 48 }, cdn)
    : typeof size === "number"
      ? fixedImage(first, { w: size, h: size, fit: "cover", position: "top" }, cdn)
      : fluidImage(first, size, cdn);
  return (
    <div className={`overflow-hidden bg-sunk ${className}`}>
      <img
        {...source}
        alt={`${slop.name} screenshot`}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        decoding="async"
        className={`size-full object-cover object-top ${blur ? "scale-110 blur-2xl" : ""}`}
      />
    </div>
  );
}
