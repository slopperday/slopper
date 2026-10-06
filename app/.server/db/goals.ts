import type { Kv } from "@deno/kv";
import type { Goal } from "~/lib/model";
import { goalEndDate, isGoalOpen } from "~/lib/goal";
import { addDays, daysBetween } from "~/lib/dates";
import { getManyValues, listValues, newId, present, withRetry } from "../kv";

/**
 * A person has at most one open goal, pointed to by `["open_goal",
 * userId]`. The pointer expires a couple of days after the goal ends so
 * the leaderboard never has to clean up after itself.
 */
function openPointerExpiry(goal: Goal, today: string): number {
  const remaining = daysBetween(today, goalEndDate(goal)) + 2;
  return Math.max(remaining, 1) * 86_400_000;
}

export async function getGoal(kv: Kv, id: string): Promise<Goal | null> {
  return (await kv.get<Goal>(["goal", id])).value;
}

/** The goal a launch today would count towards, if any. */
export async function getOpenGoal(kv: Kv, userId: string, today: string): Promise<Goal | null> {
  const pointer = await kv.get<string>(["open_goal", userId]);
  if (!pointer.value) return null;
  const goal = await getGoal(kv, pointer.value);
  return goal && isGoalOpen(goal, today) ? goal : null;
}

export interface NewGoal {
  title: string;
  target: number;
  days: number;
  startDate: string;
}

export type CreateGoalResult = { ok: true; goal: Goal } | { ok: false; error: string };

export async function createGoal(kv: Kv, userId: string, input: NewGoal, today: string): Promise<CreateGoalResult> {
  if (input.startDate < addDays(today, -1)) {
    return { ok: false, error: "Start today, or any day after." };
  }
  return await withRetry(async () => {
    const pointer = await kv.get<string>(["open_goal", userId]);
    if (pointer.value) {
      const current = await getGoal(kv, pointer.value);
      if (current && isGoalOpen(current, today)) {
        return {
          ok: false,
          error: "Finish or abandon your current card first.",
        };
      }
    }
    const goal: Goal = {
      id: newId(),
      userId,
      title: input.title,
      target: input.target,
      days: input.days,
      startDate: input.startDate,
      abandonedAt: null,
      createdAt: new Date().toISOString(),
    };
    const result = await kv
      .atomic()
      .check(pointer)
      .set(["goal", goal.id], goal)
      .set(["goals_by_user", userId, goal.id], goal.id)
      .set(["open_goal", userId], goal.id, {
        expireIn: openPointerExpiry(goal, today),
      })
      .commit();
    return result.ok ? { ok: true, goal } : null;
  });
}

export async function abandonGoal(kv: Kv, userId: string, goalId: string): Promise<boolean> {
  return await withRetry(async () => {
    const entry = await kv.get<Goal>(["goal", goalId]);
    if (!entry.value || entry.value.userId !== userId) return false;
    if (entry.value.abandonedAt) return true;
    const pointer = await kv.get<string>(["open_goal", userId]);
    const op = kv
      .atomic()
      .check(entry)
      .check(pointer)
      .set(["goal", goalId], {
        ...entry.value,
        abandonedAt: new Date().toISOString(),
      });
    if (pointer.value === goalId) op.delete(["open_goal", userId]);
    const result = await op.commit();
    return result.ok ? true : null;
  });
}

export async function listUserGoals(kv: Kv, userId: string): Promise<Goal[]> {
  const ids = await listValues<string>(kv, { prefix: ["goals_by_user", userId] }, { reverse: true });
  const goals = await getManyValues<Goal>(
    kv,
    ids.map((id) => ["goal", id]),
  );
  return goals.filter(present);
}

/** Every goal that still has an open pointer (running or just ended). */
export async function listOpenGoals(kv: Kv): Promise<Goal[]> {
  const ids = await listValues<string>(kv, { prefix: ["open_goal"] });
  const goals = await getManyValues<Goal>(
    kv,
    ids.map((id) => ["goal", id]),
  );
  return goals.filter(present).filter((c) => !c.abandonedAt);
}
