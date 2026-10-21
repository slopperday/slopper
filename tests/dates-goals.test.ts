import { describe, expect, it } from "vite-plus/test";
import { addDays, currentStreak, daysBetween, isIsoDate, localDate, localInstant, utcDate } from "~/lib/dates";
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
import { formatRelease, localDateTimeValue, nextFreeRelease, parseRelease, releaseProblem } from "~/lib/schedule";

describe("dates", () => {
  it("counts every day as the UTC day, wherever the clock is", () => {
    // 23:55 UTC on 20 Oct is already 21 Oct in Lagos; it still counts for the 20th.
    expect(utcDate(Date.parse("2026-10-20T23:55:00Z"))).toBe("2026-10-20");
    expect(utcDate(new Date("2026-10-21T00:00:00Z"))).toBe("2026-10-21");
  });

  it("reads clock dates in a time zone", () => {
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

  it("counts every slop on a day, and shows what's scheduled without counting it", () => {
    const progress = goalProgress(
      goal,
      [launch("a", "2026-10-01"), launch("b", "2026-10-01"), launch("c", "2026-10-01")],
      "2026-10-01",
      ["2026-10-02", "2026-10-04", "2026-10-04", "2026-10-09"],
    );
    expect(progress.shipped).toBe(3);
    expect(progress.days.map((day) => day.queued)).toEqual([0, 1, 0, 2, 0]);
    expect(progress.days[1].state).toBe("upcoming");
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

describe("scheduled launches", () => {
  it("turns a wall time in a zone into an instant, across clock changes", () => {
    expect(new Date(localInstant("2026-10-15", 9 * 60, "America/Los_Angeles")).toISOString()).toBe(
      "2026-10-15T16:00:00.000Z",
    );
    // London leaves summer time on 25 Oct 2026.
    expect(new Date(localInstant("2026-10-24", 60, "Europe/London")).toISOString()).toBe("2026-10-24T00:00:00.000Z");
    expect(new Date(localInstant("2026-10-26", 60, "Europe/London")).toISOString()).toBe("2026-10-26T01:00:00.000Z");
  });

  it("lines launches up on the next free days, at midnight UTC, skipping ones already taken", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    // Today's midnight has passed, so today isn't free any more.
    expect(new Date(nextFreeRelease(new Set(), "2026-10-15", now)).toISOString()).toBe("2026-10-16T00:00:00.000Z");
    const taken = new Set(["2026-10-16", "2026-10-17"]);
    expect(new Date(nextFreeRelease(taken, "2026-10-15", now)).toISOString()).toBe("2026-10-18T00:00:00.000Z");
  });

  it("reads now, next, wall times in the owner's zone and zoned times", () => {
    expect(parseRelease("now", "UTC")).toEqual({ kind: "now" });
    expect(parseRelease(" next ", "UTC")).toEqual({ kind: "next" });
    expect(parseRelease("2026-10-15T09:30", "America/New_York")).toEqual({
      kind: "at",
      at: Date.parse("2026-10-15T13:30:00Z"),
    });
    expect(parseRelease("2026-10-15T09:30:00+02:00", "America/New_York")).toEqual({
      kind: "at",
      at: Date.parse("2026-10-15T07:30:00Z"),
    });
    expect(parseRelease("2026-10-15T09:30:00Z", "Asia/Tokyo")).toEqual({
      kind: "at",
      at: Date.parse("2026-10-15T09:30:00Z"),
    });
    for (const bad of ["tomorrow", "2026-10-15", "2026-02-30T09:00", "2026-10-15T25:00", ""]) {
      expect(parseRelease(bad, "UTC")).toBeNull();
    }
  });

  it("keeps release times in the future and within reach", () => {
    const now = Date.parse("2026-10-15T12:00:00Z");
    expect(releaseProblem(now, now)).toBe("Pick a time that hasn't happened yet.");
    expect(releaseProblem(now + 60_000, now)).toBeNull();
    expect(releaseProblem(now + 101 * 86_400_000, now)).toBe("Pick a time in the next 100 days.");
  });

  it("shows release times in the owner's zone", () => {
    const at = Date.parse("2026-10-16T00:00:00Z");
    expect(formatRelease(at, "America/Los_Angeles")).toBe("Thu 15 Oct, 17:00");
    expect(localDateTimeValue(at, "America/Los_Angeles")).toBe("2026-10-15T17:00");
    expect(localDateTimeValue(at, "Asia/Tokyo")).toBe("2026-10-16T09:00");
  });
});
