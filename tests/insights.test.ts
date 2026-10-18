import { describe, expect, it } from "vite-plus/test";
import {
  formatBucket,
  formatChange,
  formatCount,
  formatDuration,
  formatPercent,
  insightQuery,
  intervalOf,
  isInsightKind,
  paramsFromObject,
  personName,
} from "~/lib/insights";

const NOW = Date.UTC(2026, 9, 18, 12);
const DAY = 86_400_000;
const params = (query: string) => new URLSearchParams(query);

describe("insight parameters", () => {
  it("reads trends from a URL, with defaults for what's missing", () => {
    expect(insightQuery("trends", params(""), NOW)).toEqual({
      kind: "trends",
      range: { from: NOW - 30 * DAY, to: NOW + 1 },
      interval: "day",
      series: [{ event: "$pageview", math: "total" }],
    });
    expect(
      insightQuery("trends", params("days=90&event=voted&event=pledged&math=persons&breakdown=value"), NOW),
    ).toEqual({
      kind: "trends",
      range: { from: NOW - 90 * DAY, to: NOW + 1 },
      interval: "week",
      series: [
        { event: "voted", math: "persons" },
        { event: "pledged", math: "persons" },
      ],
      breakdown: "value",
    });
  });

  it("keeps hand-edited URLs inside the limits", () => {
    const query = insightQuery(
      "trends",
      params("days=9999&math=everything&event=&event=a&event=b&event=c&event=d&event=e"),
      NOW,
    );
    expect(query.range.from).toBe(NOW - 365 * DAY);
    if (query.kind !== "trends") throw new Error("trends");
    expect(query.series.map((series) => series.event)).toEqual(["a", "b", "c", "d"]);
    expect(query.series[0]?.math).toBe("total");
    expect(insightQuery("trends", params("days=-4"), NOW).range.from).toBe(NOW - DAY);
  });

  it("pairs funnel steps with the pages they happened on", () => {
    expect(
      insightQuery(
        "funnel",
        params("event=$pageview&stepPath=/&event=$pageview&stepPath=/new&event=slop launched&window=3"),
        NOW,
      ),
    ).toMatchObject({
      kind: "funnel",
      windowDays: 3,
      steps: [
        { event: "$pageview", filters: [{ key: "path", operator: "equals", value: "/" }] },
        { event: "$pageview", filters: [{ key: "path", operator: "equals", value: "/new" }] },
        { event: "slop launched" },
      ],
    });
  });

  it("reads retention, journeys, stickiness, lifecycle, traffic and projects", () => {
    expect(
      insightQuery("retention", params("start=signed up&return=slop launched&interval=day&periods=99"), NOW),
    ).toMatchObject({
      kind: "retention",
      startEvent: "signed up",
      returnEvent: "slop launched",
      interval: "day",
      periods: 26,
    });
    expect(insightQuery("paths", params("start=/&end=/new&steps=3"), NOW)).toMatchObject({
      kind: "paths",
      startPath: "/",
      endPath: "/new",
      steps: 3,
    });
    expect(insightQuery("stickiness", params("event=voted"), NOW)).toMatchObject({
      kind: "stickiness",
      event: "voted",
    });
    expect(insightQuery("lifecycle", params("interval=month&days=365"), NOW)).toMatchObject({
      kind: "lifecycle",
      interval: "month",
      event: "$pageview",
    });
    expect(insightQuery("web", params("days=7"), NOW)).toMatchObject({ kind: "web", interval: "day" });
    expect(insightQuery("groups", params(""), NOW)).toMatchObject({
      kind: "groups",
      event: "$pageview",
      prefix: "slop:",
    });
  });

  it("takes the same parameters from an agent's JSON", () => {
    const fromAgent = paramsFromObject({ days: 7, event: ["voted", 3, null], math: "sessions", nothing: { a: 1 } });
    expect(insightQuery("trends", fromAgent, NOW)).toMatchObject({
      range: { from: NOW - 7 * DAY },
      series: [
        { event: "voted", math: "sessions" },
        { event: "3", math: "sessions" },
      ],
    });
    expect(fromAgent.get("nothing")).toBeNull();
  });

  it("picks an interval that keeps a chart readable", () => {
    expect(intervalOf(params(""), 30)).toBe("day");
    expect(intervalOf(params(""), 90)).toBe("week");
    expect(intervalOf(params(""), 365)).toBe("month");
    expect(intervalOf(params("interval=week"), 7)).toBe("week");
    expect(intervalOf(params("interval=year"), 7)).toBe("day");
  });

  it("knows the kinds", () => {
    expect(isInsightKind("funnel")).toBe(true);
    expect(isInsightKind("groups")).toBe(true);
    expect(isInsightKind("pie")).toBe(false);
    expect(isInsightKind(null)).toBe(false);
  });
});

describe("formatting", () => {
  it("writes counts exactly until they get long", () => {
    expect(formatCount(950)).toBe("950");
    expect(formatCount(12_340)).toBe("12,340");
    expect(formatCount(1_234_567)).toBe("1.2M");
  });

  it("writes shares, durations and changes", () => {
    expect(formatPercent(0.5)).toBe("50%");
    expect(formatPercent(0.034)).toBe("3.4%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatDuration(45_000)).toBe("45s");
    expect(formatDuration(185_000)).toBe("3m 05s");
    expect(formatDuration(7_800_000)).toBe("2h 10m");
    expect(formatChange(120, 100)).toBe("+20%");
    expect(formatChange(80, 100)).toBe("−20%");
    expect(formatChange(100, 100)).toBe("±0%");
    expect(formatChange(5, 0)).toBeNull();
  });

  it("labels buckets in UTC", () => {
    expect(formatBucket(Date.UTC(2026, 9, 12), "day")).toBe("Oct 12");
    expect(formatBucket(Date.UTC(2026, 9, 1), "month")).toBe("Oct 2026");
  });

  it("names people by username, or the end of their id", () => {
    expect(personName("ifiok", ["abc"])).toBe("@ifiok");
    expect(personName(null, ["0192f000-0000-7000-8000-0000deadbeef"])).toBe("Visitor deadbeef");
  });
});
