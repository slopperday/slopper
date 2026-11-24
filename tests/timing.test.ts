import { describe, expect, it } from "vite-plus/test";
import { roundTrips, serverTiming } from "~/.server/timing";

describe("Server-Timing", () => {
  it("counts calls that overlap as one round trip", () => {
    // Three loaders in parallel, then one call that waited on them.
    const spans = [
      { start: 0, end: 40 },
      { start: 1, end: 30 },
      { start: 2, end: 55 },
      { start: 60, end: 80 },
    ];
    expect(roundTrips(spans)).toEqual({ count: 2, wait: 75 });
    expect(roundTrips([])).toEqual({ count: 0, wait: 0 });
  });

  it("leaves out calls still running", () => {
    expect(roundTrips([{ start: 0, end: Number.NaN }])).toEqual({ count: 0, wait: 0 });
  });

  it("reports the request, Convex and a cold start", () => {
    const timing = { started: 100, convex: [{ start: 110, end: 150 }] };
    expect(serverTiming(timing, 200, null)).toBe('app;dur=100.0, convex;dur=40.0;desc="trips=1 calls=1"');
    expect(serverTiming(timing, 200, 900)).toContain('cold;dur=900.0;desc="server start to first request"');
  });
});
