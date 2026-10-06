import type { Kv } from "@deno/kv";
import { encodeTime } from "ulid";
import type { Slop } from "~/lib/model";
import { addDays } from "~/lib/dates";
import { getSlop, getSlops } from "./slops";
import { withRetry } from "../kv";

/**
 * Slop of the day. Every UTC day is one race: the slops launched that day,
 * ranked by net votes (private downvotes count against). Ties go to the slop
 * with more updates, then more feedback, then the earlier launch.
 *
 * Once a day is over its winner is frozen on first read, so the badge never
 * changes afterwards. No cron needed.
 */

export function utcDate(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

function dayStartMs(date: string): number {
  return Date.parse(`${date}T00:00:00.000Z`);
}

/** Slops launched during the UTC day `date`, read from the time index. */
export async function listSlopsLaunchedOn(kv: Kv, date: string): Promise<Slop[]> {
  const start = dayStartMs(date);
  const ids: string[] = [];
  // ULIDs start with their timestamp, so a bare time prefix brackets the day.
  for await (const entry of kv.list<string>({
    start: ["slops_by_time", encodeTime(start, 10)],
    end: ["slops_by_time", encodeTime(start + 86_400_000, 10)],
  })) {
    ids.push(entry.value);
  }
  return (await getSlops(kv, ids)).filter((slop) => !slop.hidden);
}

export function netVotes(slop: Pick<Slop, "upvotes" | "downvotes">): number {
  return slop.upvotes - slop.downvotes;
}

export function rankDay(slops: readonly Slop[]): Slop[] {
  return [...slops].sort(
    (a, b) =>
      netVotes(b) - netVotes(a) ||
      b.updateCount - a.updateCount ||
      b.commentCount - a.commentCount ||
      a.launchedAt.localeCompare(b.launchedAt),
  );
}

export interface DayRace {
  date: string;
  /** False while the day is still running. */
  final: boolean;
  ranking: Slop[];
  winnerId: string | null;
}

interface FrozenWinner {
  slopId: string | null;
  decidedAt: string;
}

/**
 * The race for `date`. Past days are frozen the first time they are read:
 * the winner needs at least one net upvote, and is badged on the slop.
 */
export async function dayRace(kv: Kv, date: string, now: Date = new Date()): Promise<DayRace> {
  const ranking = rankDay(await listSlopsLaunchedOn(kv, date));
  if (date >= utcDate(now)) {
    return { date, final: false, ranking, winnerId: null };
  }

  const key = ["slop_of_the_day", date];
  const frozen = await kv.get<FrozenWinner>(key);
  if (frozen.value) return { date, final: true, ranking, winnerId: frozen.value.slopId };

  const leader = ranking[0] && netVotes(ranking[0]) > 0 ? ranking[0] : null;
  const winnerId = await withRetry(async () => {
    const current = await kv.get<FrozenWinner>(key);
    if (current.value) return current.value.slopId ?? "";
    const op = kv
      .atomic()
      .check(current)
      .set(key, { slopId: leader?.id ?? null, decidedAt: now.toISOString() });
    if (leader) {
      const entry = await kv.get<Slop>(["slop", leader.id]);
      if (entry.value) op.check(entry).set(entry.key, { ...entry.value, slopOfTheDay: date });
    }
    return (await op.commit()).ok ? (leader?.id ?? "") : null;
  });
  return { date, final: true, ranking, winnerId: winnerId || null };
}

/** The most recent finished day's winner, looking back up to a week. */
export async function latestSlopOfTheDay(kv: Kv, now: Date = new Date()): Promise<{ date: string; slop: Slop } | null> {
  const today = utcDate(now);
  for (let back = 1; back <= 7; back++) {
    const date = addDays(today, -back);
    const race = await dayRace(kv, date, now);
    if (race.winnerId) {
      const slop = await getSlop(kv, race.winnerId);
      if (slop && !slop.hidden) return { date, slop };
    }
  }
  return null;
}
