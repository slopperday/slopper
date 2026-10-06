import { Link } from "react-router";
import type { GoalProgress } from "~/lib/goal";
import type { PublicUser } from "~/lib/model";
import { Avatar } from "./Avatar";

export interface StreakRow {
  user: PublicUser;
  progress: GoalProgress | null;
  streak: number;
}

export function StreakList({ rows }: { rows: StreakRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="mt-5 rounded-xl border-2 border-dashed border-ink/40 p-6 text-sm text-muted">
        Nobody has a goal running yet.{" "}
        <Link to="/goal" className="font-bold text-ink underline">
          Set one
        </Link>{" "}
        and you're top of the list.
      </div>
    );
  }
  return (
    <ol className="mt-5 grid gap-2">
      {rows.map((row, index) => {
        const progress = row.progress;
        const percent = progress ? Math.min(100, (progress.shipped / progress.goal.target) * 100) : 0;
        return (
          <li
            key={row.user.id}
            className="relative flex items-center gap-3 rounded-xl border-2 border-ink bg-card px-3 py-2.5"
          >
            <span className="font-wide w-6 text-center text-lg font-black text-muted">{index + 1}</span>
            <Avatar user={row.user} size="sm" />
            <div className="min-w-0 flex-1">
              <Link
                to={`/@${row.user.username}`}
                className="block truncate text-sm font-bold after:absolute after:inset-0 after:content-['']"
              >
                @{row.user.username}
              </Link>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-wall-deep">
                <div className="h-full rounded-full bg-slop-deep" style={{ width: `${percent}%` }} />
              </div>
            </div>
            <div className="text-right font-mono text-[0.7rem] leading-tight">
              {progress && (
                <p className="font-bold">
                  {progress.shipped}/{progress.goal.target}
                </p>
              )}
              <p className="text-muted">{row.streak > 0 ? `🔥${row.streak}` : "·"}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
