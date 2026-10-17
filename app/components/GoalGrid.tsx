import { Link } from "react-router";
import type { GoalDay, GoalProgress } from "~/lib/goal";
import { formatDay } from "~/lib/dates";
import { slopPath } from "~/lib/display";
import { Icon } from "./Icon";
import { tileOrder, useHydrated } from "./Tiles";

const STATUS_COPY = {
  upcoming: "Starts soon",
  active: "Slopping",
  won: "Goal hit",
  ended: "Goal over",
  abandoned: "Abandoned",
} as const;

/**
 * The goal as a board of days. Every day you ship flips its tile to a lime
 * check (with a count when you shipped more than once); a missed day keeps a
 * full stop; today waits on the lime "now" bar; a day with a launch
 * scheduled shows a clock, so everyone can see something's coming.
 */
export function GoalGrid({
  progress,
  username,
  streak,
  demo = false,
}: {
  progress: GoalProgress;
  username: string;
  streak: number;
  /** Sample on the landing page: cells are not links. */
  demo?: boolean;
}) {
  const { goal } = progress;
  const hydrated = useHydrated();
  return (
    <section
      className="board @container p-5 sm:p-7"
      aria-label={`${goal.title}: ${progress.shipped} of ${goal.target} slopped`}
    >
      <header className="flex items-end justify-between gap-x-4 sm:gap-x-6">
        <div className="min-w-0">
          <h2 className="font-display text-[1.75rem] leading-none font-extrabold sm:text-[2.4rem]">{goal.title}</h2>
          <p className="mt-2 text-[0.9375rem] text-board-muted sm:text-base">
            @{username} · {STATUS_COPY[progress.status]} · Day {progress.currentDay} of {goal.days}
          </p>
        </div>
        <p className="shrink-0 text-right font-display leading-none font-black tabular-nums">
          <span className="text-[2.75rem] sm:text-[3.6rem]">{progress.shipped}</span>
          <span className="text-[1.4rem] text-board-muted sm:text-[1.8rem]">/{goal.target}</span>
          <span className="caps block text-board-muted">slopped</span>
        </p>
      </header>

      <ol
        className={`mt-6 grid grid-cols-6 gap-1.5 @[30rem]:grid-cols-10 @[30rem]:gap-2 @[56rem]:grid-cols-15 ${hydrated ? "tile-flip" : ""}`}
      >
        {progress.days.map((day, index) => (
          <Cell key={day.date} day={day} username={username} index={index} demo={demo} />
        ))}
      </ol>

      <footer className="mt-5 flex flex-wrap justify-between gap-x-4 gap-y-1 text-board-muted">
        <span>{streak > 0 ? `${streak}-day streak` : "No streak yet"}</span>
        <span>Ends {formatDay(progress.endDate)}</span>
      </footer>
    </section>
  );
}

const CELL =
  "relative grid aspect-[4/5] w-full place-items-center rounded-md font-display text-[1.15rem] font-extrabold";

/** "2 scheduled" in a corner, beside a clock. */
function Queued({ count }: { count: number }) {
  return (
    <span aria-hidden="true" className="absolute top-1 right-1 flex items-center gap-0.5 text-[0.7rem] text-slop">
      <Icon name="clock" className="size-3" />
      {count > 1 && <span className="leading-none">×{count}</span>}
    </span>
  );
}

function Cell({ day, username, index, demo }: { day: GoalDay; username: string; index: number; demo: boolean }) {
  const label = `Day ${day.day}, ${formatDay(day.date)}`;
  const scheduled = day.queued > 0 ? `, ${day.queued} scheduled` : "";

  if (day.state === "shipped") {
    const names = day.launches.map((launch) => launch.name).join(", ");
    const count = day.launches.length;
    const content = (
      <>
        <Icon name="check" className="size-[1.9em] text-slop" />
        {count > 1 && (
          <span aria-hidden="true" className="absolute top-1 right-1.5 text-[0.7rem] leading-none text-slop">
            ×{count}
          </span>
        )}
      </>
    );
    const tile = `tile ${CELL} h-auto`;
    return (
      <li>
        {demo ? (
          <span className={tile} style={tileOrder(index)} title={`${label}: ${names}`}>
            {content}
          </span>
        ) : (
          <Link
            to={slopPath(username, day.launches[0].slug)}
            title={`${label}: ${names}`}
            aria-label={`${label}: slopped ${names}`}
            className={`${tile} transition-transform hover:-translate-y-0.5`}
            style={tileOrder(index)}
          >
            {content}
          </Link>
        )}
      </li>
    );
  }

  if (day.state === "today") {
    const tile = `tile ${CELL} h-auto`;
    const content = (
      <>
        <span>{day.day}</span>
        {day.queued > 0 && <Queued count={day.queued} />}
        <span aria-hidden="true" className="now-pulse absolute inset-x-1.5 bottom-1 h-[3px] rounded-full bg-slop" />
      </>
    );
    return (
      <li>
        {demo ? (
          <span className={tile} style={tileOrder(index)}>
            {content}
          </span>
        ) : (
          <Link
            to="/new"
            title={day.queued > 0 ? `${label}: today${scheduled}` : `${label}: today. Ship something!`}
            aria-label={`${label}: today, nothing out yet${scheduled}`}
            className={`${tile} outline-1 outline-slop hover:outline-2`}
            style={tileOrder(index)}
          >
            {content}
          </Link>
        )}
      </li>
    );
  }

  if (day.state === "missed") {
    return (
      <li title={`${label}: missed`} aria-label={`${label}: missed`} className={`${CELL} bg-tile/50`}>
        <span aria-hidden="true" className="size-1.5 rounded-full bg-board-muted" />
      </li>
    );
  }

  if (day.queued > 0) {
    return (
      <li
        title={`${label}${scheduled}`}
        aria-label={`${label}: upcoming${scheduled}`}
        className={`${CELL} border border-dashed border-slop/70 text-board-ink`}
      >
        {day.day}
        <Queued count={day.queued} />
      </li>
    );
  }

  return (
    <li
      title={label}
      aria-label={`${label}: upcoming`}
      className={`${CELL} border border-board-ink/15 text-board-muted`}
    >
      {day.day}
    </li>
  );
}
