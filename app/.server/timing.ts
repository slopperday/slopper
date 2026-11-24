import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareFunction } from "react-router";

/**
 * Where a response's time went, in its `Server-Timing` header: the whole
 * request, the time spent waiting on Convex and in how many round trips
 * (calls that overlap are one), and whether this server had just started.
 * Browsers show it in the network panel, and Lighthouse runs and `curl -I`
 * read it from production, so a change that adds a round trip shows up.
 */

interface Span {
  start: number;
  end: number;
}

interface RequestTiming {
  started: number;
  convex: Span[];
}

const storage = new AsyncLocalStorage<RequestTiming>();

/** Whether this server has answered a request yet: the first one reports the cold start. */
let served = false;

/** Times one call to Convex, when it's made while answering a request. */
export async function timed<T>(call: () => Promise<T>): Promise<T> {
  const timing = storage.getStore();
  if (!timing) return await call();
  const span = { start: performance.now(), end: Number.NaN };
  timing.convex.push(span);
  try {
    return await call();
  } finally {
    span.end = performance.now();
  }
}

/**
 * Calls that overlap in time are one round trip; the waiting is the length
 * of their union, not their sum.
 */
export function roundTrips(spans: readonly Span[]): { count: number; wait: number } {
  const done = spans.filter((span) => Number.isFinite(span.end)).toSorted((a, b) => a.start - b.start);
  let count = 0;
  let wait = 0;
  let end = Number.NEGATIVE_INFINITY;
  for (const span of done) {
    if (span.start >= end) {
      count++;
      wait += span.end - span.start;
      end = span.end;
    } else if (span.end > end) {
      wait += span.end - end;
      end = span.end;
    }
  }
  return { count, wait };
}

function metric(name: string, duration: number, description?: string): string {
  return `${name};dur=${duration.toFixed(1)}${description ? `;desc="${description}"` : ""}`;
}

/** The `Server-Timing` value for a request that took this long. */
export function serverTiming(timing: RequestTiming, now: number, cold: number | null): string {
  const convex = roundTrips(timing.convex);
  const metrics = [
    metric("app", now - timing.started),
    metric("convex", convex.wait, `trips=${convex.count} calls=${timing.convex.length}`),
  ];
  if (cold !== null) metrics.push(metric("cold", cold, "server start to first request"));
  return metrics.join(", ");
}

/** First in the root middleware, so it times everything after it. */
export const timingMiddleware: MiddlewareFunction<Response> = async (_args, next) => {
  const timing: RequestTiming = { started: performance.now(), convex: [] };
  // performance.now() counts from the process's start, so the first request's is the cold start.
  const cold = served ? null : timing.started;
  served = true;
  const response = await storage.run(timing, next);
  try {
    response.headers.append("server-timing", serverTiming(timing, performance.now(), cold));
  } catch {
    // A response with immutable headers (a fetch passed through) keeps them as they are.
  }
  return response;
};
