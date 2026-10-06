import { Link } from "react-router";
import type { CardItem } from "@convex/lib/shape";
import { dayLabel, numberLabel, slopPath, tiltFor } from "~/lib/display";
import { timeAgo } from "~/lib/dates";
import { Avatar } from "./Avatar";
import { CategoryChip, PlatformChips, SlopcessfulChip, SlopImage, SlopOfTheDayChip } from "./SlopBits";
import { VoteButtons } from "./VoteButtons";

export type { CardItem };

/**
 * A slop, taped to the wall. The whole card is one link (stretched from the
 * title) with the vote control and owner link layered above it.
 */
export function SlopCard({ item, index = 0 }: { item: CardItem; index?: number }) {
  const { slop, owner } = item;
  const href = slopPath(owner.username, slop.slug);
  const day = dayLabel(slop);
  const style = {
    "--i": String(index),
    "--tilt": `${tiltFor(slop.id)}deg`,
  } as React.CSSProperties;

  return (
    <article className="thrown relative" style={style}>
      <div className="stuck flex h-full flex-col transition-transform duration-200 hover:-translate-y-1">
        <div className="tape" aria-hidden="true" />
        <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-3 font-mono text-[0.65rem] tracking-wider uppercase">
          <div className="grid gap-0.5">
            <span className="font-bold">Slop {numberLabel(slop)}</span>
            <span className="text-muted">
              {day ?? "No goal"} · {timeAgo(slop.launchedAt)}
            </span>
          </div>
          <Link
            to={`/@${owner.username}`}
            className="relative z-10 flex items-center gap-1.5 tracking-normal normal-case hover:underline"
          >
            <Avatar user={owner} size="xs" />
            <span className="max-w-[9rem] truncate">@{owner.username}</span>
          </Link>
        </header>
        <div className="flex flex-1 flex-col gap-3 px-4 pb-4">
          <SlopImage slop={slop} blur={slop.nsfw} className="aspect-[16/10] rounded-md border-2 border-ink" />
          <div>
            <h3 className="font-wide text-lg leading-tight font-black">
              <Link to={href} className="after:absolute after:inset-0 after:content-[''] focus:outline-none">
                {slop.name}
              </Link>
            </h3>
            <p className="mt-1 line-clamp-2 text-sm text-muted">{slop.tagline}</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {slop.launchLabel && <span className="chip chip-beta">🚀 {slop.launchLabel}</span>}
            {slop.slopcessfulAt && <SlopcessfulChip />}
            {slop.slopOfTheDay && <SlopOfTheDayChip date={slop.slopOfTheDay} />}
            <PlatformChips links={slop.links} />
            {slop.nsfw && <span className="chip chip-nsfw">NSFW</span>}
            <CategoryChip category={slop.category} />
          </div>
          <footer className="mt-auto flex items-center justify-between pt-1">
            <VoteButtons
              slopId={slop.id}
              upvotes={slop.upvotes}
              vote={item.vote}
              mode={item.voteMode}
              loginHref={`/login?returnTo=${encodeURIComponent(href)}`}
            />
            <span className="font-mono text-[0.7rem] text-muted">
              {slop.commentCount > 0 && <span title="Feedback">💬 {slop.commentCount}</span>}
              {slop.fieldTests > 0 && (
                <span className="ml-2" title="Field tests">
                  👟 {slop.fieldTests}
                </span>
              )}
              {slop.updateCount > 1 && (
                <span className="ml-2" title="Updates">
                  ↻ {slop.updateCount - 1}
                </span>
              )}
            </span>
          </footer>
        </div>
      </div>
    </article>
  );
}

export function SlopGrid({ items }: { items: CardItem[] }) {
  return (
    <div className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item, index) => (
        <SlopCard key={item.slop.id} item={item} index={index} />
      ))}
    </div>
  );
}
