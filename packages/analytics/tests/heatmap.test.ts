import { describe, expect, it } from "vite-plus/test";
import { type EventRow, HEATMAP_CELL, HeatmapAggregator, type HeatmapQuery, parsePoint } from "../src/shared/insights";

/** Heatmaps from events: clicks placed for the drawn width, views, scroll depth and what was clicked. */

const NOW = Date.UTC(2026, 9, 18);

function row(overrides: Partial<EventRow> = {}): EventRow {
  return {
    name: "$heatmap",
    personId: "p1",
    sessionId: "s1",
    timestamp: NOW - 1_000,
    path: "/wall",
    properties: {},
    ...overrides,
  };
}

function query(overrides: Partial<HeatmapQuery> = {}): HeatmapQuery {
  return {
    kind: "heatmap",
    range: { from: NOW - 86_400_000, to: NOW },
    path: "/wall",
    device: "desktop",
    ...overrides,
  };
}

describe("parsePoint", () => {
  it("reads x,y and nothing else", () => {
    expect(parsePoint("12,340")).toEqual({ x: 12, y: 340 });
    expect(parsePoint("-3,10")).toEqual({ x: -3, y: 10 });
    for (const bad of ["", "1", "1,2,3", "a,b", "1.5,2", "1,-2"]) expect(parsePoint(bad), bad).toBeNull();
  });
});

describe("HeatmapAggregator", () => {
  it("places clicks for the drawn width by their distance from the middle", () => {
    const heatmap = new HeatmapAggregator(query());
    // At 1440 wide, the middle is 720: 820 is 100 right of it, so 740 at 1280.
    heatmap.add(row({ properties: { viewportWidth: 1440, points: ["820,100", "820,101", "2000,5", "nonsense"] } }));
    heatmap.add(row({ properties: { viewportWidth: 1280, points: ["740,100"] } }));
    const result = heatmap.result();
    expect(result).toMatchObject({ kind: "heatmap", path: "/wall", device: "desktop", width: 1280, clicks: 3 });
    const x = Math.floor(740 / HEATMAP_CELL) * HEATMAP_CELL;
    const y = Math.floor(100 / HEATMAP_CELL) * HEATMAP_CELL;
    expect(result.cells).toEqual([{ x, y, clicks: 3 }]);
  });

  it("keeps to its page, its kind of screen and its range", () => {
    const heatmap = new HeatmapAggregator(query({ device: "mobile" }));
    heatmap.add(row({ properties: { viewportWidth: 390, points: ["10,10"] } }));
    heatmap.add(row({ path: "/today", properties: { viewportWidth: 390, points: ["10,10"] } }));
    heatmap.add(row({ properties: { viewportWidth: 1280, points: ["10,10"] } }));
    heatmap.add(row({ timestamp: NOW, properties: { viewportWidth: 390, points: ["10,10"] } }));
    heatmap.add(row({ properties: { points: ["10,10"] } }));
    expect(heatmap.result().clicks).toBe(1);
  });

  it("counts views, how far down visits got, and what was clicked most", () => {
    const heatmap = new HeatmapAggregator(query());
    const wide = { viewportWidth: 1280 };
    heatmap.add(row({ name: "$pageview", properties: wide }));
    heatmap.add(row({ name: "$pageview", properties: wide }));
    heatmap.add(row({ name: "$pageleave", properties: { ...wide, scrollDepth: 1 } }));
    heatmap.add(row({ name: "$pageleave", properties: { ...wide, scrollDepth: 0.35 } }));
    for (const text of ["Search", "Search", "New slop"]) {
      heatmap.add(row({ name: "$autocapture", properties: { ...wide, eventType: "click", text } }));
    }
    heatmap.add(row({ name: "$autocapture", properties: { ...wide, eventType: "change", text: "Search" } }));
    heatmap.add(row({ name: "$autocapture", properties: { ...wide, eventType: "click", selector: "main > a" } }));
    const result = heatmap.result();
    expect(result.views).toBe(2);
    expect(result.reached).toEqual([1, 1, 1, 1, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5]);
    expect(result.elements).toEqual([
      { label: "Search", clicks: 2 },
      { label: "main > a", clicks: 1 },
      { label: "New slop", clicks: 1 },
    ]);
  });

  it("reads nothing as nobody scrolling", () => {
    expect(new HeatmapAggregator(query()).result()).toMatchObject({ clicks: 0, views: 0, reached: Array(11).fill(0) });
  });
});
