import { describe, expect, it } from "vite-plus/test";
import { addDays, currentStreak, daysBetween, isIsoDate, localDate } from "~/lib/dates";
import {
  GOAL_PACES,
  type Goal,
  goalDayFor,
  goalEndDate,
  goalProgress,
  goalShareText,
  type Launch,
  paceTarget,
} from "~/lib/goal";
import { hotScore, rankHot } from "~/lib/ranking";

describe("dates", () => {
  it("uses the owner's time zone, not UTC", () => {
    // 23:30 UTC on 5 Oct is already 6 Oct in Lagos and still 5 Oct in New York.
    const instant = new Date("2026-10-05T23:30:00Z");
    expect(localDate(instant, "UTC")).toBe("2026-10-05");
    expect(localDate(instant, "Africa/Lagos")).toBe("2026-10-06");
    expect(localDate(instant, "America/New_York")).toBe("2026-10-05");
  });

  it("does calendar math across DST and month ends", () => {
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-10", "2026-10-01")).toBe(-9);
  });

  it("rejects impossible dates", () => {
    expect(isIsoDate("2026-02-28")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("26-02-01")).toBe(false);
  });

  it("keeps a streak alive until the end of today", () => {
    const today = "2026-10-06";
    expect(currentStreak(["2026-10-03", "2026-10-04", "2026-10-05"], today)).toBe(3);
    expect(currentStreak(["2026-10-04", "2026-10-05", "2026-10-06"], today)).toBe(3);
    expect(currentStreak(["2026-10-03", "2026-10-04"], today)).toBe(0);
    expect(currentStreak(["2026-10-06", "2026-10-06"], today)).toBe(1);
  });
});

describe("goal grid", () => {
  const goal: Goal = { title: "5 in 5", target: 5, days: 5, startDate: "2026-10-01", abandonedAt: null };
  const launch = (id: string, launchDate: string): Launch => ({ id, name: id, slug: id, launchDate });

  it("is inclusive at both ends", () => {
    expect(goalEndDate(goal)).toBe("2026-10-05");
    expect(goalDayFor(goal, "2026-10-01")).toBe(1);
    expect(goalDayFor(goal, "2026-10-05")).toBe(5);
    expect(goalDayFor(goal, "2026-09-30")).toBeNull();
    expect(goalDayFor(goal, "2026-10-06")).toBeNull();
  });

  it("marks shipped, missed, today and upcoming days", () => {
    const progress = goalProgress(
      goal,
      [launch("a", "2026-10-01"), launch("b", "2026-10-03"), launch("c", "2026-10-03"), launch("x", "2026-09-29")],
      "2026-10-04",
    );
    expect(progress.days.map((day) => day.state)).toEqual(["shipped", "missed", "shipped", "today", "upcoming"]);
    expect(progress.days[2].launches).toHaveLength(2);
    expect(progress.shipped).toBe(3);
    expect(progress.currentDay).toBe(4);
    expect(progress.status).toBe("active");
  });

  it("wins early when the target is hit, and reports other statuses", () => {
    expect(
      goalProgress({ ...goal, target: 2 }, [launch("a", "2026-10-01"), launch("b", "2026-10-02")], "2026-10-02").status,
    ).toBe("won");
    expect(goalProgress(goal, [], "2026-09-30").status).toBe("upcoming");
    expect(goalProgress(goal, [], "2026-10-09").status).toBe("ended");
    expect(goalProgress({ ...goal, abandonedAt: 1 }, [], "2026-10-03").status).toBe("abandoned");
  });
});

describe("hot ranking", () => {
  const base = { upvotes: 0, downvotes: 0, commentCount: 0, updateCount: 1, fieldTests: 0 };
  const now = new Date("2026-10-06T12:00:00Z");

  it("lets private downvotes cost points and field tests earn them", () => {
    const fresh = now.getTime();
    expect(hotScore({ ...base, upvotes: 3, downvotes: 2, lastActivityAt: fresh }, now)).toBeLessThan(
      hotScore({ ...base, upvotes: 3, lastActivityAt: fresh }, now),
    );
    expect(hotScore({ ...base, fieldTests: 2, lastActivityAt: fresh }, now)).toBeGreaterThan(
      hotScore({ ...base, commentCount: 2, lastActivityAt: fresh }, now),
    );
  });

  it("decays with time since the last activity", () => {
    const ranked = rankHot(
      [
        { ...base, upvotes: 5, lastActivityAt: now.getTime() - 3 * 86_400_000, name: "old" },
        { ...base, upvotes: 2, lastActivityAt: now.getTime(), name: "fresh" },
      ],
      now,
    );
    expect(ranked.map((slop) => slop.name)).toEqual(["fresh", "old"]);
  });
});

describe("setting a goal", () => {
  it("scales each pace to the days, never below one slop", () => {
    expect(GOAL_PACES.map((pace) => paceTarget(pace, 10))).toEqual([2, 5, 10, 20]);
    expect(GOAL_PACES.map((pace) => paceTarget(pace, 1))).toEqual([1, 1, 1, 2]);
    expect(GOAL_PACES.map((pace) => paceTarget(pace, 365))).toEqual([73, 183, 365, 730]);
  });

  it("shares the goal in the maker's words when they named it", () => {
    expect(goalShareText({ title: "30 slops in 30 days", target: 30, days: 30 })).toBe(
      "I'm throwing 30 slops at the wall in 30 days. Hold me to it.",
    );
    expect(goalShareText({ title: "Slopvember", target: 1, days: 1 })).toBe(
      "Slopvember: I'm throwing 1 slop at the wall in 1 day. Hold me to it.",
    );
  });
});
