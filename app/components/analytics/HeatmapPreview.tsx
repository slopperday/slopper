import { useCallback, useEffect, useRef, useState } from "react";
import type { HeatmapCell } from "@slopperday/analytics/shared/insights";

/**
 * A page as it is now, drawn at the width a heatmap was gathered for, with
 * its clicks laid over it. The page loads in a same-origin frame (the CSP
 * allows only that), where analytics doesn't run, and can't be clicked.
 */

/** Until the framed page says how tall it is: one screen, since a page fills its frame at least. */
const START_HEIGHT = 900;
/** How far one cell's heat spreads, in cells. */
const SPREAD = 2.5;

export function HeatmapPreview({
  path,
  width,
  cell,
  cells,
}: {
  path: string;
  width: number;
  cell: number;
  cells: readonly HeatmapCell[];
}) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [height, setHeight] = useState(START_HEIGHT);
  const [scale, setScale] = useState(1);

  const measure = useCallback(() => {
    const page = frame.current?.contentDocument?.documentElement;
    if (page)
      setHeight(
        Math.max(
          page.scrollHeight,
          cells.reduce((low, spot) => Math.max(low, spot.y + cell), 0),
        ),
      );
  }, [cell, cells]);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const fit = () => setScale(Math.min(1, element.clientWidth / width));
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [width]);

  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, width, height);
    const most = cells.reduce((high, spot) => Math.max(high, spot.clicks), 1);
    const radius = cell * SPREAD;
    for (const spot of cells) {
      const x = spot.x + cell / 2;
      const y = spot.y + cell / 2;
      const strength = 0.25 + 0.75 * (spot.clicks / most);
      const glow = context.createRadialGradient(x, y, 0, x, y, radius);
      glow.addColorStop(0, `rgba(235, 104, 52, ${strength})`);
      glow.addColorStop(1, "rgba(235, 104, 52, 0)");
      context.fillStyle = glow;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }
  }, [cells, cell, width, height]);

  return (
    <div
      ref={box}
      className="relative w-full overflow-hidden rounded-xl border border-line bg-raised"
      style={{ height: Math.round(height * scale) }}
    >
      <div
        className="absolute top-0 left-0"
        style={{ width, height, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        <iframe
          ref={frame}
          src={path}
          title={`${path} as it is now`}
          width={width}
          height={height}
          tabIndex={-1}
          className="pointer-events-none block border-0"
          onLoad={() => {
            measure();
            // Late content (images, live data) can make it taller.
            setTimeout(measure, 1_500);
          }}
        />
        <canvas
          ref={canvas}
          width={width}
          height={height}
          className="pointer-events-none absolute inset-0"
          aria-hidden
        />
      </div>
    </div>
  );
}
