import { Link } from "react-router";
import type { GoalDay, GoalProgress } from "~/lib/goal";
import type { PublicUser } from "@convex/lib/shape";
import { Avatar } from "./Avatar";
import { EmptyState } from "./Shared";

export interface StreakRow {
  user: PublicUser;
  progress: GoalProgress | null;
  streak: number;
}

const RUN_COLOURS: Record<GoalDay["state"], string> = {
  shipped: "bg-slop",
  today: "bg-ink/35",
  missed: "bg-hot/45",
  upcoming: "bg-line-strong",
};

/** A goal's days in one thin strip: the shape of someone's run at a glance. */
function Run({ days }: { days: readonly GoalDay[] }) {
  return (
    <span aria-hidden="true" className="mt-2 flex h-2 gap-px overflow-hidden rounded-full">
      {days.map((day) => (
        <span key={day.date} className={`min-w-px flex-1 ${RUN_COLOURS[day.state]}`} />
      ))}
    </span>
  );
}

export function StreakList({ rows }: { rows: StreakRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState>
        Nobody has a goal running yet.{" "}
        <Link to="/goal" className="link text-ink">
          Set one
        </Link>{" "}
        and you're top of the list.
      </EmptyState>
    );
  }
  return (
    <ol className="divide-y divide-line border-y border-line">
      {rows.map((row, index) => {
        const progress = row.progress;
        return (
          <li key={row.user.id} className="group relative flex items-center gap-3 py-3.5">
            <span className="w-6 shrink-0 text-center font-display text-[1.5rem] leading-none font-black text-faint tabular-nums">
              {index + 1}
            </span>
            <Avatar user={row.user} size="sm" />
            <div className="min-w-0 flex-1">
              <Link
                to={`/@${row.user.username}`}
                className="block truncate font-bold after:absolute after:inset-0 after:content-[''] group-hover:underline"
              >
                @{row.user.username}
              </Link>
              {progress && <Run days={progress.days} />}
            </div>
            <div className="shrink-0 text-right leading-tight">
              {progress && (
                <p className="font-display text-[1.35rem] font-extrabold tabular-nums">
                  {progress.shipped}
                  <span className="text-muted">/{progress.goal.target}</span>
                </p>
              )}
              <p className="text-sm text-muted">{row.streak > 0 ? `${row.streak}-day streak` : "No streak"}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
