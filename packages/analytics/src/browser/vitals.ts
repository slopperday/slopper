import { type Metric, onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import type { Properties } from "../shared/properties";

/**
 * Core Web Vitals for the page this visit landed on, from real visits. The
 * SDK loads this after the page has: the browser keeps the paint and layout
 * entries the vitals are read from, so nothing is lost by waiting. Values
 * update as the page is used, and go once, as `$webVitals`, when it's hidden.
 */

const KEYS: Record<Metric["name"], string> = { LCP: "lcp", INP: "inp", CLS: "cls", FCP: "fcp", TTFB: "ttfb" };

export class Vitals {
  private readonly values: Properties = {};
  private sent = false;

  start(): void {
    const record = (metric: Metric) => {
      this.values[KEYS[metric.name]] =
        metric.name === "CLS" ? Math.round(metric.value * 1000) / 1000 : Math.round(metric.value);
    };
    const options = { reportAllChanges: true };
    onLCP(record, options);
    onINP(record, options);
    onCLS(record, options);
    onFCP(record, options);
    onTTFB(record, options);
  }

  /** What was measured, once; null when there's nothing yet, or it went already. */
  take(): Properties | null {
    if (this.sent || Object.keys(this.values).length === 0) return null;
    this.sent = true;
    return { ...this.values };
  }
}
