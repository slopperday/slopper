import { EVENTS } from "../events";
import type { HeatmapDevice, HeatmapQuery } from "./queries";
import type { EventRow } from "./rows";

/**
 * Where people click on one page, and how far down they get, for one kind
 * of screen. Clicks arrive as `$heatmap` events (points `x,y` in CSS pixels
 * from the page's top left, at the viewport width they were made at). Each
 * is moved to the width the heatmap is drawn at by its distance from the
 * middle, which is exact for centred layouts and close for full-width ones.
 */

/** Screens by viewport width, and the width each kind's heatmap is drawn at. */
export const HEATMAP_DEVICES: Record<HeatmapDevice, { min: number; max: number; width: number }> = {
  mobile: { min: 0, max: 767, width: 390 },
  tablet: { min: 768, max: 1199, width: 1024 },
  desktop: { min: 1200, max: Number.POSITIVE_INFINITY, width: 1280 },
};

/** Clicks are counted in squares this many CSS pixels wide. */
export const HEATMAP_CELL = 16;

/** Points one `$heatmap` event carries at most (a property list's limit). */
export const HEATMAP_POINTS = 50;

export interface HeatmapCell {
  /** The square's top-left corner, at the drawn width. */
  x: number;
  y: number;
  clicks: number;
}

export interface HeatmapResult {
  kind: "heatmap";
  path: string;
  device: HeatmapDevice;
  /** The width the page is drawn at; cells are placed for it. */
  width: number;
  cell: number;
  cells: HeatmapCell[];
  clicks: number;
  /** Page views on this kind of screen. */
  views: number;
  /** `reached[i]`: the share of page leaves that had scrolled at least `i * 10`% of the way down. */
  reached: number[];
  /** What was clicked most: links and buttons by their text (or selector), from autocapture. */
  elements: { label: string; clicks: number }[];
}

/** Elements listed at most. */
const ELEMENTS = 10;

/** "x,y" as numbers, or null for anything else. */
export function parsePoint(point: string): { x: number; y: number } | null {
  const match = /^(-?\d{1,6}),(\d{1,7})$/.exec(point);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

export class HeatmapAggregator {
  private readonly cells = new Map<string, HeatmapCell>();
  private clicks = 0;
  private views = 0;
  private readonly depths: number[] = [];
  private readonly elements = new Map<string, number>();
  private readonly screen: (typeof HEATMAP_DEVICES)[HeatmapDevice];

  constructor(private readonly query: HeatmapQuery) {
    this.screen = HEATMAP_DEVICES[query.device];
  }

  /** The viewport width an event was made at, if it's this kind of screen's. */
  private widthOf(event: EventRow): number | null {
    if (event.path !== this.query.path) return null;
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return null;
    const width = event.properties.viewportWidth;
    if (typeof width !== "number" || width < this.screen.min || width > this.screen.max) return null;
    return width;
  }

  /** `$heatmap`, `$pageview`, `$pageleave` and `$autocapture` clicks; anything else is skipped. */
  add(event: EventRow): void {
    const width = this.widthOf(event);
    if (width === null) return;
    if (event.name === EVENTS.pageview) {
      this.views += 1;
    } else if (event.name === EVENTS.autocapture) {
      if (event.properties.eventType !== "click") return;
      const { text, selector } = event.properties;
      const label = typeof text === "string" && text ? text : typeof selector === "string" ? selector : null;
      if (label) this.elements.set(label, (this.elements.get(label) ?? 0) + 1);
    } else if (event.name === EVENTS.pageleave) {
      const depth = event.properties.scrollDepth;
      if (typeof depth === "number") this.depths.push(Math.max(0, Math.min(1, depth)));
    } else if (event.name === EVENTS.heatmap) {
      const points = event.properties.points;
      if (!Array.isArray(points)) return;
      for (const raw of points) {
        const point = parsePoint(raw);
        if (!point) continue;
        const x = Math.round(this.screen.width / 2 + (point.x - width / 2));
        if (x < 0 || x >= this.screen.width) continue;
        const cellX = Math.floor(x / HEATMAP_CELL) * HEATMAP_CELL;
        const cellY = Math.floor(point.y / HEATMAP_CELL) * HEATMAP_CELL;
        const key = `${cellX},${cellY}`;
        const cell = this.cells.get(key) ?? { x: cellX, y: cellY, clicks: 0 };
        cell.clicks += 1;
        this.cells.set(key, cell);
        this.clicks += 1;
      }
    }
  }

  result(): HeatmapResult {
    const reached = Array.from({ length: 11 }, (_, step) =>
      this.depths.length === 0
        ? 0
        : this.depths.filter((depth) => depth >= step / 10 - 1e-9).length / this.depths.length,
    );
    return {
      kind: "heatmap",
      path: this.query.path,
      device: this.query.device,
      width: this.screen.width,
      cell: HEATMAP_CELL,
      cells: [...this.cells.values()].sort((a, b) => a.y - b.y || a.x - b.x),
      clicks: this.clicks,
      views: this.views,
      reached,
      elements: [...this.elements]
        .map(([label, clicks]) => ({ label, clicks }))
        .sort((a, b) => b.clicks - a.clicks || a.label.localeCompare(b.label))
        .slice(0, ELEMENTS),
    };
  }
}
