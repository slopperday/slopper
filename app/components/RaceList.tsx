import { Link } from "react-router";
import { dayLabel, slopPath } from "~/lib/display";
import { Avatar } from "./Avatar";
import type { CardItem } from "./SlopCard";
import { PlatformChips, SlopImage } from "./SlopBits";
import { VoteButtons } from "./VoteButtons";

/** The day's race, ranked like a leaderboard. */
export function RaceList({ items, winnerId }: { items: CardItem[]; winnerId: string | null }) {
  return (
    <ol className="grid gap-3">
      {items.map((item, index) => {
        const { slop, owner } = item;
        const href = slopPath(owner.username, slop.slug);
        const winner = slop.id === winnerId;
        return (
          <li
            key={slop.id}
            className={`relative flex min-w-0 items-center gap-3 rounded-2xl border-2 border-ink p-3 transition-transform hover:-translate-y-0.5 sm:gap-4 sm:p-4 ${
              winner ? "bg-gold text-[#151513]" : "bg-card"
            }`}
          >
            <span className="font-wide w-7 shrink-0 text-center text-2xl font-black tabular-nums opacity-70">
              {index + 1}
            </span>
            <SlopImage
              slop={slop}
              blur={slop.nsfw}
              className="size-14 shrink-0 rounded-xl border-2 border-ink sm:size-16"
            />
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2">
                <Link
                  to={href}
                  className="font-wide truncate text-lg font-black after:absolute after:inset-0 after:content-['']"
                >
                  {slop.name}
                </Link>
                {slop.launchLabel && <span className="chip chip-beta">🚀 {slop.launchLabel}</span>}
                {winner && <span className="chip border-[#151513]">🏆 Slop of the day</span>}
              </p>
              <p className="truncate text-sm opacity-75">{slop.tagline}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.65rem] tracking-wider uppercase opacity-80">
                <Link
                  to={`/@${owner.username}`}
                  className="relative z-10 flex items-center gap-1.5 normal-case hover:underline"
                >
                  <Avatar user={owner} size="xs" />@{owner.username}
                </Link>
                {dayLabel(slop) && <span>{dayLabel(slop)}</span>}
                {slop.updateCount > 1 && <span>↻ {slop.updateCount - 1} updates</span>}
                {slop.fieldTests > 0 && <span>👟 {slop.fieldTests} field tests</span>}
                {slop.commentCount > 0 && <span>💬 {slop.commentCount}</span>}
                <span className="hidden gap-1 sm:flex">
                  <PlatformChips links={slop.links} />
                </span>
              </p>
            </div>
            <VoteButtons
              slopId={slop.id}
              upvotes={slop.upvotes}
              vote={item.vote}
              mode={item.voteMode}
              loginHref={`/login?returnTo=${encodeURIComponent(href)}`}
            />
          </li>
        );
      })}
    </ol>
  );
}
