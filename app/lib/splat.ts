/**
 * Deterministic splat shapes. A splat is a lumpy disc with a few splash arms
 * and loose droplets. The same seed always gives the same shape, so server
 * and client render identical markup.
 */

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (const char of text) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return hash >>> 0;
}

export interface SplatShape {
  /** Closed path in a 100×100 box. */
  path: string;
  droplets: { cx: number; cy: number; r: number }[];
}

const round = (value: number) => Math.round(value * 10) / 10;

export function splatShape(seed: number, lumps = 15): SplatShape {
  const random = mulberry32(seed);
  const points: [number, number][] = [];
  for (let i = 0; i < lumps; i++) {
    const angle = (i / lumps) * Math.PI * 2 + random() * 0.2;
    let radius = 27 + random() * 9;
    if (random() > 0.7) radius += 9 + random() * 11;
    points.push([50 + Math.cos(angle) * radius, 50 + Math.sin(angle) * radius]);
  }
  const mid = (a: [number, number], b: [number, number]) => `${round((a[0] + b[0]) / 2)} ${round((a[1] + b[1]) / 2)}`;
  let path = `M ${mid(points[lumps - 1], points[0])}`;
  for (let i = 0; i < lumps; i++) {
    const point = points[i];
    path += ` Q ${round(point[0])} ${round(point[1])} ${mid(point, points[(i + 1) % lumps])}`;
  }
  path += " Z";

  const droplets = Array.from({ length: 3 }, () => {
    const angle = random() * Math.PI * 2;
    const distance = 41 + random() * 7;
    return {
      cx: round(50 + Math.cos(angle) * distance),
      cy: round(50 + Math.sin(angle) * distance),
      r: round(1.8 + random() * 2.6),
    };
  });
  return { path, droplets };
}
