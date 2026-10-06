import { addDays, daysBetween } from "./dates";
import type { Goal } from "./model";

/** The minimum a goal grid needs to know about a shipped slop. */
export interface Launch {
  id: string;
  name: string;
  slug: string;
  launchDate: string;
}

export type DayState = "shipped" | "missed" | "today" | "upcoming";

export interface GoalDay {
  day: number;
  date: string;
  state: DayState;
  launches: Launch[];
}

export type GoalStatus = "upcoming" | "active" | "won" | "ended" | "abandoned";

export interface GoalProgress {
  goal: Goal;
  endDate: string;
  /** 1-based day of the goal for `today`, clamped to the range. */
  currentDay: number;
  shipped: number;
  status: GoalStatus;
  days: GoalDay[];
}

export function goalEndDate(goal: Goal): string {
  return addDays(goal.startDate, goal.days - 1);
}

/** Which day of the goal a launch date falls on, if any. */
export function goalDayFor(goal: Goal, launchDate: string): number | null {
  const day = daysBetween(goal.startDate, launchDate) + 1;
  return day >= 1 && day <= goal.days ? day : null;
}

export function isGoalOpen(goal: Goal, today: string): boolean {
  return goal.abandonedAt === null && today <= goalEndDate(goal);
}

/**
 * Builds the goal grid: one cell per day of the goal with the slops
 * launched on it. `launches` may include slops outside the window.
 */
export function goalProgress(goal: Goal, launches: readonly Launch[], today: string): GoalProgress {
  const endDate = goalEndDate(goal);
  const byDate = new Map<string, Launch[]>();
  for (const launch of launches) {
    if (launch.launchDate < goal.startDate) continue;
    if (launch.launchDate > endDate) continue;
    const list = byDate.get(launch.launchDate) ?? [];
    list.push(launch);
    byDate.set(launch.launchDate, list);
  }

  const days: GoalDay[] = [];
  let shipped = 0;
  for (let index = 0; index < goal.days; index++) {
    const date = addDays(goal.startDate, index);
    const dayLaunches = byDate.get(date) ?? [];
    shipped += dayLaunches.length;
    let state: DayState;
    if (dayLaunches.length > 0) state = "shipped";
    else if (date === today) state = "today";
    else if (date < today) state = "missed";
    else state = "upcoming";
    days.push({ day: index + 1, date, state, launches: dayLaunches });
  }

  const elapsed = daysBetween(goal.startDate, today) + 1;
  const currentDay = Math.min(Math.max(elapsed, 1), goal.days);

  let status: GoalStatus;
  if (goal.abandonedAt) status = "abandoned";
  else if (shipped >= goal.target) status = "won";
  else if (today < goal.startDate) status = "upcoming";
  else if (today > endDate) status = "ended";
  else status = "active";

  return { goal, endDate, currentDay, shipped, status, days };
}
