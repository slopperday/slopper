import { Link } from "react-router";
import type { GoalDay, GoalProgress } from "~/lib/goal";
import { formatDay } from "~/lib/dates";
import { slopPath } from "~/lib/display";
import { seedFrom } from "~/lib/splat";
import { Splat } from "./Splat";

const STATUS_COPY = {
  upcoming: "Starts soon",
  active: "Slopping",
  won: "Goal hit",
  ended: "Goal over",
  abandoned: "Abandoned",
} as const;

/**
 * The goal as a wall of days. Every day you ship leaves a splat; missed days
 * stay bare.
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
  const percent = Math.min(100, Math.round((progress.shipped / goal.target) * 100));
  return (
    <section
      className="stuck overflow-hidden p-5 sm:p-7"
      aria-label={`${goal.title}: ${progress.shipped} of ${goal.target} slopped`}
    >
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">@{username} · goal</p>
          <h2 className="font-wide mt-1 text-2xl leading-none font-black sm:text-3xl">{goal.title}</h2>
        </div>
        <div className="text-right">
          <p className="font-wide text-5xl leading-none font-black tabular-nums">
            {progress.shipped}
            <span className="text-2xl text-muted">/{goal.target}</span>
          </p>
          <p className="eyebrow">slopped</p>
        </div>
      </header>

      <ol className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(2.7rem,1fr))] gap-2.5">
        {progress.days.map((day, index) => (
          <Cell key={day.date} day={day} username={username} index={index} demo={demo} />
        ))}
      </ol>

      <div className="mt-6 h-3 overflow-hidden rounded-full border-2 border-ink bg-wall">
        <div className="h-full bg-slop transition-[width] duration-700" style={{ width: `${percent}%` }} />
      </div>
      <footer className="mt-3 flex flex-wrap justify-between gap-2 font-mono text-[0.68rem] tracking-wider uppercase">
        <span>
          {STATUS_COPY[progress.status]} · Day {progress.currentDay} of {goal.days}
        </span>
        <span>
          {streak > 0 ? `🔥 ${streak} day streak` : "No streak yet"} · ends {formatDay(progress.endDate)}
        </span>
      </footer>
    </section>
  );
}

function Cell({ day, username, index, demo }: { day: GoalDay; username: string; index: number; demo: boolean }) {
  const label = `Day ${day.day}, ${formatDay(day.date)}`;
  const base = "relative grid aspect-square place-items-center rounded-full font-mono text-[0.7rem] font-bold";

  if (day.state === "shipped") {
    const names = day.launches.map((launch) => launch.name).join(", ");
    const content = (
      <>
        <Splat
          seed={seedFrom(day.date + username)}
          className="splat-in absolute -inset-1.5 text-slop"
          style={
            {
              "--i": String(index),
              "--spin": `${(index * 47) % 360}deg`,
            } as React.CSSProperties
          }
        />
        <span className="relative text-slop-ink">{day.launches.length > 1 ? `×${day.launches.length}` : day.day}</span>
      </>
    );
    return (
      <li>
        {demo ? (
          <span className={base} title={`${label}: ${names}`}>
            {content}
          </span>
        ) : (
          <Link
            to={slopPath(username, day.launches[0].slug)}
            title={`${label}: ${names}`}
            aria-label={`${label}: slopped ${names}`}
            className={`${base} transition-transform hover:scale-110`}
          >
            {content}
          </Link>
        )}
      </li>
    );
  }
  if (day.state === "today") {
    const className = `${base} cell-today border-[3px] border-dashed border-slop-deep text-ink`;
    return (
      <li>
        {demo ? (
          <span className={className}>{day.day}</span>
        ) : (
          <Link
            to="/new"
            title={`${label}: today. Ship something!`}
            aria-label={`${label}: today, nothing yet`}
            className={`${className} hover:bg-slop/30`}
          >
            {day.day}
          </Link>
        )}
      </li>
    );
  }
  if (day.state === "missed") {
    return (
      <li
        title={`${label}: missed`}
        aria-label={`${label}: missed`}
        className={`${base} border-2 border-line text-hot`}
      >
        <span aria-hidden="true" className="text-base">
          ✕
        </span>
      </li>
    );
  }
  return (
    <li
      title={label}
      aria-label={`${label}: upcoming`}
      className={`${base} border-2 border-dotted border-ink/30 text-muted`}
    >
      {day.day}
    </li>
  );
}
