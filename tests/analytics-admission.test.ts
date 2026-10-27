// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { httpRouter } from "convex/server";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { components } from "@convex/_generated/api";
import schema from "@convex/schema";
import analyticsSchema from "../packages/analytics/src/component/schema";
import { INGEST_LIMITS } from "../packages/analytics/src/component/lib/limits";
import { Analytics } from "../packages/analytics/src/convex";
import { replayChunkParams } from "../packages/analytics/src/shared/replay";

const modules = import.meta.glob("../convex/**/*.ts");
const analyticsModules = import.meta.glob("../packages/analytics/src/component/**/*.ts");
const ORIGIN = "https://example.com";

// Exercise the real counters with a small test budget, without a 600-request loop.
vi.mock("../packages/analytics/src/component/lib/limits", async (importOriginal) => {
  const original = await importOriginal<typeof import("../packages/analytics/src/component/lib/limits")>();
  return { ...original, INGEST_LIMITS: { ...original.INGEST_LIMITS, requestsPerAddressPerMinute: 6 } };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("charges malformed and empty requests before bodies, paths, or replay actions", async () => {
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  const groupsForPaths = vi.fn(async () => new Map<string, string>());
  const http = httpRouter();
  new Analytics(components.analytics).registerRoutes(http, { allowedOrigins: [ORIGIN], groupsForPaths });
  const app = convexTest(schema, { ...modules, "../convex/http.ts": async () => ({ default: http }) });
  app.registerComponent("analytics", analyticsSchema, analyticsModules);
  const t = app.withRequestMetadata({ ip: "192.0.2.1" });
  const post = (body: string, extra: Record<string, string> = {}) => ({
    method: "POST",
    body,
    headers: { origin: ORIGIN, "user-agent": "Mozilla/5.0", ...extra },
  });

  // These all return without storing anything. None may escape the attempt budget.
  for (let i = 0; i < INGEST_LIMITS.requestsPerAddressPerMinute; i++) {
    const replay = i % 3 === 2;
    const response = await t.fetch(replay ? "/a/r" : "/a/e", post(i % 3 === 0 ? "{" : "{}"));
    expect(response.status).toBe(replay || i % 3 === 0 ? 400 : 200);
  }

  const text = vi.spyOn(Request.prototype, "text");
  const arrayBuffer = vi.spyOn(Request.prototype, "arrayBuffer");
  const now = Date.now();
  const body = JSON.stringify({
    sentAt: now,
    events: [{ uuid: "event", distinctId: "new-id", name: "$pageview", timestamp: now, path: "/wall" }],
  });
  const events = await t.fetch("/a/e", post(body, { "x-forwarded-for": "192.0.2.99" }));
  expect(events.status).toBe(429);
  expect(events.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  const params = replayChunkParams({
    sessionId: "session",
    distinctId: "visitor",
    startedAt: now,
    endedAt: now,
    sentAt: now,
    events: 1,
    encoding: "identity",
  });
  expect((await t.fetch(`/a/r?${params}`, post("[]"))).status).toBe(429);
  expect(text).not.toHaveBeenCalled();
  expect(arrayBuffer).not.toHaveBeenCalled();
  expect(groupsForPaths).not.toHaveBeenCalled();
  expect(await app.query(components.analytics.events.recent, {})).toEqual([]);
  expect(await app.query(components.analytics.recordings.get, { sessionId: "session" })).toBeNull();
}, 15_000);
