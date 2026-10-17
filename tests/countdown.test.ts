import { describe, expect, it } from "vite-plus/test";
import { raceClock, secondsToUtcMidnight } from "~/lib/countdown";

const MIDNIGHT = Date.UTC(2026, 9, 18);

/** The clock with `h:m:s` left before midnight UTC on 18 Oct. */
function clockWithLeft(h: number, m: number, s: number) {
  return raceClock(secondsToUtcMidnight(new Date(MIDNIGHT - ((h * 60 + m) * 60 + s) * 1000)));
}

describe("race clock", () => {
  it("reads hours and minutes all day, and extends to the seconds", () => {
    expect(clockWithLeft(23, 59, 59)).toEqual({
      text: "23:59",
      textWithSeconds: "23:59:59",
      spoken: "23 hours 59 minutes",
      lastHour: false,
    });
    expect(clockWithLeft(12, 0, 0)).toEqual({
      text: "12:00",
      textWithSeconds: "12:00:00",
      spoken: "12 hours",
      lastHour: false,
    });
    expect(clockWithLeft(1, 4, 30)).toEqual({
      text: "01:04",
      textWithSeconds: "01:04:30",
      spoken: "1 hour 4 minutes",
      lastHour: false,
    });
  });

  it("turns red for the last hour, still in hours and minutes", () => {
    expect(clockWithLeft(1, 0, 0)).toEqual({
      text: "01:00",
      textWithSeconds: "01:00:00",
      spoken: "1 hour",
      lastHour: false,
    });
    expect(clockWithLeft(0, 59, 59)).toEqual({
      text: "00:59",
      textWithSeconds: "00:59:59",
      spoken: "59 minutes",
      lastHour: true,
    });
  });

  it("never reads 00:00 while the race is open", () => {
    expect(clockWithLeft(0, 0, 30)).toEqual({
      text: "00:01",
      textWithSeconds: "00:00:30",
      spoken: "1 minute",
      lastHour: true,
    });
    expect(clockWithLeft(0, 0, 1)).toEqual({
      text: "00:01",
      textWithSeconds: "00:00:01",
      spoken: "1 minute",
      lastHour: true,
    });
    expect(raceClock(secondsToUtcMidnight(new Date(MIDNIGHT - 1))).textWithSeconds).toBe("00:00:01");
  });

  it("counts to the next midnight from any moment of the day", () => {
    expect(secondsToUtcMidnight(new Date("2026-10-17T23:59:59Z"))).toBe(1);
    expect(secondsToUtcMidnight(new Date("2026-10-18T00:00:00Z"))).toBe(86_399);
    expect(secondsToUtcMidnight(new Date("2026-10-18T00:00:01Z"))).toBe(86_399);
    expect(secondsToUtcMidnight(new Date("2026-10-18T00:00:02Z"))).toBe(86_398);
    expect(secondsToUtcMidnight(new Date("2026-10-18T12:00:00Z"))).toBe(43_200);
    expect(raceClock(secondsToUtcMidnight(new Date("2026-10-18T22:59:59Z"))).lastHour).toBe(false);
    expect(raceClock(secondsToUtcMidnight(new Date("2026-10-18T23:00:00Z"))).lastHour).toBe(false);
    expect(raceClock(secondsToUtcMidnight(new Date("2026-10-18T23:00:01Z"))).lastHour).toBe(true);
    for (let ms = 0; ms < 86_400_000; ms += 997_331) {
      const seconds = secondsToUtcMidnight(new Date(MIDNIGHT + ms));
      expect(seconds).toBeGreaterThanOrEqual(1);
      expect(seconds).toBeLessThan(86_400);
    }
  });

  it("is still in the last hour at 00:01 in London, which is 23:01 UTC", () => {
    expect(raceClock(secondsToUtcMidnight(new Date("2026-10-18T00:01:15+01:00")))).toMatchObject({
      text: "00:58",
      textWithSeconds: "00:58:45",
      lastHour: true,
    });
  });
});
