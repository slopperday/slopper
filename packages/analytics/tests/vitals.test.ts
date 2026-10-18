// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Vitals } from "../src/browser/vitals";
import { type EventRow, rateVital, VitalsAggregator } from "../src/shared/insights";

/** Core Web Vitals: what the browser measures and keeps, and their percentiles across loads. */

type Report = (metric: { name: string; value: number }) => void;
const reports = new Map<string, Report>();

vi.mock("web-vitals", () => {
  const listen = (name: string) => (report: Report) => reports.set(name, report);
  return {
    onLCP: listen("LCP"),
    onINP: listen("INP"),
    onCLS: listen("CLS"),
    onFCP: listen("FCP"),
    onTTFB: listen("TTFB"),
  };
});

beforeEach(() => reports.clear());

describe("Vitals", () => {
  it("keeps the latest of each value, rounded, and gives them up once", () => {
    const vitals = new Vitals();
    expect(vitals.take()).toBeNull();
    vitals.start();
    reports.get("LCP")?.({ name: "LCP", value: 1200.4 });
    reports.get("LCP")?.({ name: "LCP", value: 1850.6 });
    reports.get("CLS")?.({ name: "CLS", value: 0.04567 });
    reports.get("INP")?.({ name: "INP", value: 96 });
    expect(vitals.take()).toEqual({ lcp: 1851, cls: 0.046, inp: 96 });
    expect(vitals.take()).toBeNull();
  });
});

describe("VitalsAggregator", () => {
  const range = { from: 0, to: 10_000 };
  const load = (path: string, properties: EventRow["properties"], timestamp = 1_000): EventRow => ({
    name: "$webVitals",
    personId: "p1",
    sessionId: "s1",
    timestamp,
    path,
    properties,
  });

  it("rates values by web.dev's thresholds", () => {
    expect(rateVital("lcp", 2_500)).toBe("good");
    expect(rateVital("lcp", 2_501)).toBe("needs-improvement");
    expect(rateVital("lcp", 4_001)).toBe("poor");
    expect(rateVital("cls", 0.05)).toBe("good");
    expect(rateVital("inp", 600)).toBe("poor");
  });

  it("takes the 75th percentile of each, with the shares of good, middling and poor loads", () => {
    const vitals = new VitalsAggregator({ kind: "vitals", range });
    for (const lcp of [1_000, 2_000, 3_000, 5_000]) vitals.add(load("/wall", { lcp, cls: 0.01 }));
    vitals.add(load("/today", { lcp: 900, inp: 120 }));
    vitals.add(load("/today", { lcp: "slow", inp: -5 }));
    vitals.add(load("/wall", { lcp: 99_999 }, 20_000));
    vitals.add({ ...load("/wall", { lcp: 1 }), name: "$pageview" });
    const result = vitals.result();
    expect(result.loads).toBe(6);
    expect(result.vitals.lcp).toEqual({
      p75: 3_000,
      rating: "needs-improvement",
      samples: 5,
      shares: { good: 0.6, "needs-improvement": 0.2, poor: 0.2 },
    });
    expect(result.vitals.inp).toMatchObject({ p75: 120, rating: "good", samples: 1 });
    expect(result.vitals.ttfb).toMatchObject({ p75: null, rating: null, samples: 0 });
    expect(result.pages.map((page) => [page.path, page.loads, page.p75.lcp])).toEqual([
      ["/wall", 4, 3_000],
      ["/today", 2, 900],
    ]);
  });
});
