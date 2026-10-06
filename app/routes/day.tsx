import { Link } from "react-router";
import type { Route } from "./+types/day";
import { getKv } from "~/.server/kv";
import { viewerContext } from "~/.server/session";
import { dayRace, utcDate } from "~/.server/db/daily";
import { toFeedItems } from "~/.server/feed";
import { notFound } from "~/.server/http";
import { memo } from "~/.server/memo";
import { addDays, formatDay, isIsoDate } from "~/lib/dates";
import { seo } from "~/lib/seo";
import { Countdown } from "~/components/Countdown";
import { RaceList } from "~/components/RaceList";
import { EmptyState } from "~/components/Shared";

/** One UTC day's race: `/today` live, `/day/2026-10-06` for the archive. */
export async function loader({ params, context }: Route.LoaderArgs) {
  const now = new Date();
  const today = utcDate(now);
  const date = params.date ?? today;
  if (!isIsoDate(date) || date > today) notFound();
  const kv = await getKv();
  const race = await memo(`race:${date}`, 15_000, () => dayRace(kv, date, now));
  return {
    date,
    today,
    final: race.final,
    winnerId: race.winnerId,
    items: await toFeedItems(kv, race.ranking, context.get(viewerContext).user),
  };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, {
    title: loaderData && !loaderData.final ? "Today's race" : `Slop of the day · ${loaderData?.date ?? ""}`,
    description: "Every day's slops, ranked by votes. The top one is slop of the day.",
    path: loaderData ? `/day/${loaderData.date}` : undefined,
  });

export default function Day({ loaderData }: Route.ComponentProps) {
  const { date, today, final } = loaderData;
  const previous = addDays(date, -1);
  const next = addDays(date, 1);
  return (
    <section className="mx-auto max-w-4xl px-4 py-12">
      <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-xs tracking-wider uppercase">
        <Link to={`/day/${previous}`} className="hover:underline">
          ← {formatDay(previous)}
        </Link>
        {date < today && (
          <Link to={next === today ? "/today" : `/day/${next}`} className="hover:underline">
            {next === today ? "Today" : formatDay(next)} →
          </Link>
        )}
      </div>
      <p className="eyebrow mt-8">{final ? "Final results" : "Live · ranked by votes"}</p>
      <h1 className="font-wide mt-2 text-4xl font-black sm:text-5xl">
        {final ? `Slop of the day: ${formatDay(date)}` : "Today's race"}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-muted">
        {final ? (
          <p>Days run midnight to midnight UTC. Votes after the day ends don't change the winner.</p>
        ) : (
          <>
            <Countdown utc label="until it closes" />
            <p className="text-sm">The top slop at midnight UTC wins slop of the day.</p>
          </>
        )}
      </div>
      <div className="mt-10">
        {loaderData.items.length > 0 ? (
          <RaceList items={loaderData.items} winnerId={loaderData.winnerId} />
        ) : (
          <EmptyState>
            {final ? "Nobody slopped this day." : "Nothing launched yet today. First slop has the race to itself."}
            {!final && (
              <div>
                <Link to="/new" className="btn btn-slop mt-6">
                  Enter the race
                </Link>
              </div>
            )}
          </EmptyState>
        )}
      </div>
    </section>
  );
}
