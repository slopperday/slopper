import { Link } from "react-router";
import type { Route } from "./+types/day";
import { api } from "@convex/_generated/api";
import { viewerContext } from "~/.server/session";
import { convex } from "~/.server/convex";
import { notFound } from "~/.server/http";
import { addDays, formatDay, isIsoDate } from "~/lib/dates";
import { seo } from "~/lib/seo";
import { Countdown } from "~/components/Countdown";
import { RaceList } from "~/components/SlopList";
import { EmptyState } from "~/components/Shared";
import { Icon } from "~/components/Icon";
import { useLive } from "~/components/Live";

/** One UTC day's race: `/today` live, `/day/2026-10-06` for the archive. */
export async function loader({ params, context }: Route.LoaderArgs) {
  const today = new Date().toISOString().slice(0, 10);
  const date = params.date ?? today;
  if (!isIsoDate(date) || date > today) notFound();
  const race = await convex.query(api.race.day, { date, asUser: context.get(viewerContext).user?._id });
  return { today, race };
}

export const meta: Route.MetaFunction = ({ matches, loaderData }) =>
  seo(matches, {
    title: loaderData && !loaderData.race.final ? "Today's race" : `Slop of the day · ${loaderData?.race.date ?? ""}`,
    description: "Every day's slops, ranked by votes. The top one is slop of the day.",
    path: loaderData ? `/day/${loaderData.race.date}` : undefined,
  });

export default function Day({ loaderData }: Route.ComponentProps) {
  const race = useLive(api.race.day, { date: loaderData.race.date }, loaderData.race);
  const { date, final } = race;
  const previous = addDays(date, -1);
  const next = addDays(date, 1);
  return (
    <section className="mx-auto max-w-4xl px-4 pt-10">
      <nav aria-label="Days" className="flex flex-wrap items-center justify-between gap-3 font-bold">
        <Link to={`/day/${previous}`} className="inline-flex min-h-11 items-center gap-1.5 text-muted hover:text-ink">
          <Icon name="left" className="size-4" /> {formatDay(previous)}
        </Link>
        {date < loaderData.today && (
          <Link
            to={next === loaderData.today ? "/today" : `/day/${next}`}
            className="inline-flex min-h-11 items-center gap-1.5 text-muted hover:text-ink"
          >
            {next === loaderData.today ? "Today" : formatDay(next)} <Icon name="right" className="size-4" />
          </Link>
        )}
      </nav>
      <h1 className="title-1 mt-8">{final ? `Slop of the day: ${formatDay(date)}` : "Today's race"}</h1>
      {final ? (
        <p className="lede mt-4">
          Final results. Days run midnight to midnight UTC. The winner is crowned just after midnight and never changes.
        </p>
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3">
          <Countdown className="text-[2.25rem]" />
          <p className="text-muted">Live, ranked by votes. The top slop at midnight UTC wins slop of the day.</p>
        </div>
      )}
      <div className="mt-12">
        {race.items.length > 0 ? (
          <RaceList items={race.items} winnerId={race.winnerId} />
        ) : (
          <EmptyState>
            {final ? "Nobody slopped this day." : "Nothing launched yet today. The first slop has the race to itself."}
            {!final && (
              <div>
                <Link to="/new" className="btn btn-slop btn-lg mt-6">
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
