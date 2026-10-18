import { EVENTS } from "../events";
import type { VitalsQuery } from "./queries";
import type { EventRow } from "./rows";

/**
 * Core Web Vitals from real visits (`$webVitals`, one per page load): the
 * 75th percentile of each, as Google reads them, how many loads were good,
 * needed work or were poor, and the same per page.
 */

export const VITALS = ["lcp", "inp", "cls", "fcp", "ttfb"] as const;
export type Vital = (typeof VITALS)[number];

/** Good up to the first number, poor past the second (web.dev's thresholds). Times in ms; CLS has no unit. */
export const VITAL_THRESHOLDS: Record<Vital, readonly [number, number]> = {
  lcp: [2_500, 4_000],
  inp: [200, 500],
  cls: [0.1, 0.25],
  fcp: [1_800, 3_000],
  ttfb: [800, 1_800],
};

export type VitalRating = "good" | "needs-improvement" | "poor";

export function rateVital(vital: Vital, value: number): VitalRating {
  const [good, poor] = VITAL_THRESHOLDS[vital];
  return value <= good ? "good" : value <= poor ? "needs-improvement" : "poor";
}

export interface VitalSummary {
  /** The 75th percentile; null without samples. */
  p75: number | null;
  rating: VitalRating | null;
  samples: number;
  /** Shares of loads that were good, needed improvement and were poor. */
  shares: Record<VitalRating, number>;
}

export interface VitalsResult {
  kind: "vitals";
  loads: number;
  vitals: Record<Vital, VitalSummary>;
  /** The pages with most loads, each with its vitals' 75th percentiles. */
  pages: { path: string; loads: number; p75: Record<Vital, number | null> }[];
}

const PAGES = 20;

/** The 75th percentile, nearest rank. */
function percentile75(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * 0.75) - 1] ?? null;
}

function emptyValues(): Record<Vital, number[]> {
  return { lcp: [], inp: [], cls: [], fcp: [], ttfb: [] };
}

export class VitalsAggregator {
  private readonly all = emptyValues();
  private readonly byPage = new Map<string, { loads: number; values: Record<Vital, number[]> }>();
  private loads = 0;

  constructor(private readonly query: VitalsQuery) {}

  add(event: EventRow): void {
    if (event.name !== EVENTS.webVitals) return;
    if (event.timestamp < this.query.range.from || event.timestamp >= this.query.range.to) return;
    const path = event.path ?? "?";
    const page = this.byPage.get(path) ?? { loads: 0, values: emptyValues() };
    this.byPage.set(path, page);
    this.loads += 1;
    page.loads += 1;
    for (const vital of VITALS) {
      const value = event.properties[vital];
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) continue;
      this.all[vital].push(value);
      page.values[vital].push(value);
    }
  }

  result(): VitalsResult {
    const summarize = (vital: Vital): VitalSummary => {
      const values = this.all[vital];
      const p75 = percentile75(values);
      const counts: Record<VitalRating, number> = { good: 0, "needs-improvement": 0, poor: 0 };
      for (const value of values) counts[rateVital(vital, value)] += 1;
      const share = (rating: VitalRating) => (values.length === 0 ? 0 : counts[rating] / values.length);
      return {
        p75,
        rating: p75 === null ? null : rateVital(vital, p75),
        samples: values.length,
        shares: { good: share("good"), "needs-improvement": share("needs-improvement"), poor: share("poor") },
      };
    };
    return {
      kind: "vitals",
      loads: this.loads,
      vitals: {
        lcp: summarize("lcp"),
        inp: summarize("inp"),
        cls: summarize("cls"),
        fcp: summarize("fcp"),
        ttfb: summarize("ttfb"),
      },
      pages: [...this.byPage]
        .sort(([pathA, a], [pathB, b]) => b.loads - a.loads || pathA.localeCompare(pathB))
        .slice(0, PAGES)
        .map(([path, page]) => ({
          path,
          loads: page.loads,
          p75: {
            lcp: percentile75(page.values.lcp),
            inp: percentile75(page.values.inp),
            cls: percentile75(page.values.cls),
            fcp: percentile75(page.values.fcp),
            ttfb: percentile75(page.values.ttfb),
          },
        })),
    };
  }
}
