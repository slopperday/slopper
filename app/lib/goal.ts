import { addDays, daysBetween } from "./dates";
/** What goal math needs from a stored goal. */
export interface Goal {
  title: string;
  target: number;
  days: number;
  startDate: string;
  abandonedAt: number | null;
}

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

/** Commitments offered first when setting a goal; any length from 1 day up works too. */
export const GOAL_DAY_CHOICES = [7, 14, 30, 100] as const;

/** How hard to go once the days are picked, as slops per day. */
export const GOAL_PACES = [
  { id: "safe", label: "Safe", perDay: 0.2, blurb: "One every five days." },
  { id: "steady", label: "Getting there", perDay: 0.5, blurb: "One every other day." },
  { id: "hardcore", label: "Hardcore", perDay: 1, blurb: "One a day. Every day." },
  { id: "impossible", label: "Impossible", perDay: 2, blurb: "Two a day. Good luck." },
] as const;

export type GoalPace = (typeof GOAL_PACES)[number];

export const DEFAULT_GOAL_DAYS = 30;
export const DEFAULT_GOAL_PACE: GoalPace = GOAL_PACES[2];

export function findGoalPace(id: string): GoalPace | undefined {
  return GOAL_PACES.find((pace) => pace.id === id);
}

/** Slops a pace asks for over `days`, never fewer than one. */
export function paceTarget(pace: GoalPace, days: number): number {
  return Math.max(1, Math.round(days * pace.perDay));
}

/** What someone posts when they share their goal, before the link. A custom name leads. */
export function goalShareText(goal: Pick<Goal, "title" | "target" | "days">): string {
  const slops = goal.target === 1 ? "1 slop" : `${goal.target} slops`;
  const days = goal.days === 1 ? "1 day" : `${goal.days} days`;
  const pledge = `I'm throwing ${slops} at the wall in ${days}. Hold me to it.`;
  return goal.title === `${goal.target} slops in ${goal.days} days` ? pledge : `${goal.title}: ${pledge}`;
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
