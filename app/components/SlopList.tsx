import { Link, useRouteLoaderData } from "react-router";
import type { CardItem } from "@convex/lib/shape";
import { dayLabel, plural, slopPath } from "~/lib/display";
import { RelativeTime } from "./RelativeTime";
import { Avatar } from "./Avatar";
import { LaunchLabelTag, NsfwTag, Platforms, SlopcessfulTag, SlopCover, SlopOfTheDayTag } from "./SlopBits";
import { VoteButtons } from "./VoteButtons";

export type { CardItem };

/** Whether feedback counts show: comments can be off (COMMENTS_ENABLED, read by the root loader). */
function useCommentsEnabled(): boolean {
  return useRouteLoaderData<{ commentsEnabled: boolean }>("root")?.commentsEnabled ?? false;
}

/** "1 field test · 2 feedback · 3 updates", leaving out what hasn't happened. */
function activity(slop: CardItem["slop"], commentsEnabled: boolean): string[] {
  const updates = slop.updateCount - 1;
  return [
    slop.fieldTests > 0 ? plural(slop.fieldTests, "field test", "field tests") : null,
    commentsEnabled && slop.commentCount > 0 ? `${slop.commentCount} feedback` : null,
    updates > 0 ? plural(updates, "update", "updates") : null,
  ].filter((part) => part !== null);
}

function Tags({ slop, winner = false }: { slop: CardItem["slop"]; winner?: boolean }) {
  return (
    <>
      {slop.launchLabel && <LaunchLabelTag label={slop.launchLabel} />}
      {winner ? (
        <span className="tag tag-gold">Slop of the day</span>
      ) : (
        slop.slopOfTheDay && <SlopOfTheDayTag date={slop.slopOfTheDay} />
      )}
      {slop.slopcessfulAt && <SlopcessfulTag />}
      {slop.nsfw && <NsfwTag />}
    </>
  );
}

function Votes({ item, href }: { item: CardItem; href: string }) {
  return (
    <VoteButtons
      slopId={item.slop.id}
      upvotes={item.slop.upvotes}
      vote={item.vote}
      mode={item.voteMode}
      loginHref={`/login?returnTo=${encodeURIComponent(href)}`}
    />
  );
}

function Maker({ owner }: { owner: CardItem["owner"] }) {
  return (
    <Link
      to={`/@${owner.username}`}
      className="relative z-10 -my-2.5 flex items-center gap-1.5 py-2.5 font-bold hover:text-ink"
    >
      <Avatar user={owner} size="xs" />@{owner.username}
    </Link>
  );
}

/**
 * One slop as a row on the board: its cover (or a shipped-day tile), name,
 * line, who threw it and when, and the votes. The whole row is one link,
 * stretched from the name, with the maker link and votes above it.
 */
function SlopRow({
  item,
  rank,
  lead = false,
  winner = false,
}: {
  item: CardItem;
  /** Position in a ranked race; unranked lists leave it out. */
  rank?: number;
  /** Billing follows rank: the leader's name is set biggest. */
  lead?: boolean;
  winner?: boolean;
}) {
  const { slop, owner } = item;
  const href = slopPath(owner.username, slop.slug);
  const day = dayLabel(slop);
  const counts = activity(slop, useCommentsEnabled());
  return (
    <li className="group relative flex min-w-0 items-center gap-3 py-4 sm:gap-5 sm:py-5">
      {rank !== undefined && (
        <span
          className={`w-7 shrink-0 text-center font-display leading-none font-black tabular-nums sm:w-9 ${
            winner ? "text-[2.5rem] text-gold-text" : lead ? "text-[2.5rem]" : "text-[1.9rem] text-faint"
          }`}
        >
          {rank}
        </span>
      )}
      <SlopCover
        slop={slop}
        blur={item.blur}
        className={`shrink-0 self-start rounded-xl ${rank !== undefined ? "hidden sm:grid" : ""} ${lead ? "size-20" : "size-14 sm:size-16"}`}
      />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link
            to={href}
            className={`min-w-0 truncate font-display leading-[1.05] font-extrabold after:absolute after:inset-0 after:content-[''] group-hover:underline group-hover:decoration-2 ${
              lead ? "text-[1.9rem] sm:text-[2.25rem]" : "text-[1.45rem]"
            }`}
          >
            {slop.name}
          </Link>
          <Tags slop={slop} winner={winner} />
        </p>
        <p className="line-clamp-2 text-muted">{slop.tagline}</p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
          <Maker owner={owner} />
          <span>{day ?? "No goal"}</span>
          <RelativeTime at={slop.launchedAt} />
          {counts.map((part) => (
            <span key={part}>{part}</span>
          ))}
          <span className="hidden sm:inline">
            <Platforms links={slop.links} publication={slop.publication?.format} />
          </span>
        </p>
      </div>
      <Votes item={item} href={href} />
    </li>
  );
}

/** The day's race, set like a departures board: ranked by votes. */
export function RaceList({ items, winnerId }: { items: CardItem[]; winnerId: string | null }) {
  return (
    <ol className="divide-y divide-line border-y border-line">
      {items.map((item, index) => (
        <SlopRow
          key={item.slop.id}
          item={item}
          rank={index + 1}
          lead={index === 0}
          winner={item.slop.id === winnerId}
        />
      ))}
    </ol>
  );
}

/** Slops on the wall, freshest or stickiest first. */
export function SlopList({ items }: { items: CardItem[] }) {
  return (
    <ul className="divide-y divide-line border-y border-line">
      {items.map((item) => (
        <SlopRow key={item.slop.id} item={item} />
      ))}
    </ul>
  );
}

/**
 * One slop given the stage, for the latest slop of the day: its screenshot
 * when it has one, otherwise the name leads beside a shipped-day tile.
 */
export function SlopFeature({ item }: { item: CardItem }) {
  const { slop, owner } = item;
  const href = slopPath(owner.username, slop.slug);
  const day = dayLabel(slop);
  const counts = activity(slop, useCommentsEnabled());
  const screenshot = slop.screenshots.length > 0;
  return (
    <article className="group relative">
      {screenshot && <SlopCover slop={slop} blur={item.blur} className="mb-4 aspect-[16/10] w-full rounded-2xl" />}
      <div className="flex items-start justify-between gap-3">
        {!screenshot && <SlopCover slop={slop} className="size-14 shrink-0 rounded-xl" />}
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-[2rem] leading-none font-extrabold">
            <Link
              to={href}
              className="after:absolute after:inset-0 after:content-[''] group-hover:underline group-hover:decoration-2"
            >
              {slop.name}
            </Link>
          </h3>
          <p className="mt-1.5 text-muted">{slop.tagline}</p>
        </div>
        <Votes item={item} href={href} />
      </div>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
        <Maker owner={owner} />
        <span>{day ?? "No goal"}</span>
        {counts.map((part) => (
          <span key={part}>{part}</span>
        ))}
      </p>
    </article>
  );
}
