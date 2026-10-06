import type { Kv } from "@deno/kv";
import { type Goal, type PublicUser, publicUser, type Slop, type User } from "~/lib/model";
import { goalProgress, type GoalProgress, type Launch } from "~/lib/goal";
import { currentStreak, localDate } from "~/lib/dates";
import { listOpenGoals } from "./db/goals";
import { listUserSlops } from "./db/slops";
import { getUsersById } from "./feed";

export function toLaunches(slops: readonly Slop[]): Launch[] {
  return slops.filter((slop) => !slop.hidden).map(({ id, name, slug, launchDate }) => ({ id, name, slug, launchDate }));
}

export interface SlopperCard {
  user: PublicUser;
  progress: GoalProgress | null;
  streak: number;
  totalShipped: number;
}

/** Everything a profile or streak row needs about one person. */
export function slopperCard(user: User, slops: readonly Slop[], goal: Goal | null, now: Date): SlopperCard {
  const today = localDate(now, user.timeZone);
  const launches = toLaunches(slops);
  return {
    user: publicUser(user),
    progress: goal ? goalProgress(goal, launches, today) : null,
    streak: currentStreak(
      launches.map((launch) => launch.launchDate),
      today,
    ),
    totalShipped: launches.length,
  };
}

const STATUS_RANK = { won: 0, active: 1, upcoming: 2, ended: 3, abandoned: 4 };

/** People with an open goal, best run first. */
export async function standings(kv: Kv, now: Date = new Date()): Promise<SlopperCard[]> {
  const goals = await listOpenGoals(kv);
  const users = await getUsersById(
    kv,
    goals.map((goal) => goal.userId),
  );
  const cards: SlopperCard[] = [];
  for (const goal of goals) {
    const user = users.get(goal.userId);
    if (!user) continue;
    cards.push(slopperCard(user, await listUserSlops(kv, user.id), goal, now));
  }
  return cards.sort((a, b) => {
    const pa = a.progress!;
    const pb = b.progress!;
    return (
      STATUS_RANK[pa.status] - STATUS_RANK[pb.status] ||
      b.streak - a.streak ||
      pb.shipped / pb.goal.target - pa.shipped / pa.goal.target
    );
  });
}
