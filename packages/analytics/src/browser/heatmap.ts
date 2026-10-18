import { EVENTS } from "../shared/events";
import { HEATMAP_POINTS } from "../shared/insights/heatmap";
import type { Properties } from "../shared/properties";

/**
 * Every click on a page, for heatmaps: where it landed in page coordinates
 * (CSS pixels from the top left of the whole page, not the screen), dead
 * clicks on plain text included. Points are sent in batches of up to 50, one
 * `$heatmap` event per page and viewport width, so a busy page costs a few
 * events rather than one per click. Clicks inside `[data-no-capture]` aren't
 * kept.
 */

type Capture = (name: string, properties: Properties, path: string) => void;

const IGNORED = "[data-no-capture]";

interface Batch {
  path: string;
  viewportWidth: number;
  points: string[];
}

export class ClickMap {
  private batch: Batch | null = null;

  constructor(
    private readonly capture: Capture,
    private readonly currentPath: () => string,
  ) {}

  add(event: MouseEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(IGNORED)) return;
    const path = this.currentPath();
    const viewportWidth = window.innerWidth;
    if (this.batch && (this.batch.path !== path || this.batch.viewportWidth !== viewportWidth)) this.flush();
    this.batch ??= { path, viewportWidth, points: [] };
    this.batch.points.push(`${Math.round(event.pageX)},${Math.round(event.pageY)}`);
    if (this.batch.points.length >= HEATMAP_POINTS) this.flush();
  }

  /** Sends what's been gathered: on leaving a page, and as the page goes away. */
  flush(): void {
    const batch = this.batch;
    this.batch = null;
    if (!batch || batch.points.length === 0) return;
    this.capture(EVENTS.heatmap, { points: batch.points, viewportWidth: batch.viewportWidth }, batch.path);
  }

  /** Listens for clicks; returns a function that stops. */
  start(): () => void {
    const onClick = (event: MouseEvent) => this.add(event);
    document.addEventListener("click", onClick, { capture: true, passive: true });
    return () => document.removeEventListener("click", onClick, { capture: true });
  }
}
