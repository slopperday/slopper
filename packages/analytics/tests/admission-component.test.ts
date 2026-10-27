// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { api } from "../src/component/_generated/api";
import { INGEST_LIMITS } from "../src/component/lib/limits";
import schema from "../src/component/schema";

const modules = import.meta.glob("../src/component/**/*.ts");
const MINUTE = 60_000;
const DAY = 86_400_000;

afterEach(() => vi.useRealTimers());

describe("public analytics admission", () => {
  it("shares the address attempt budget across endpoints and resets it next minute", async () => {
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    const t = convexTest(schema, modules);
    const visitor = t.withRequestMetadata({ ip: "192.0.2.1" });
    expect(await visitor.mutation(api.ingest.admit, { kind: "events" })).toBe(true);
    await t.run(async (ctx) => {
      const rows = await ctx.db.query("counters").collect();
      const address = rows.find((row) => row.key.startsWith("requests:address:"));
      expect(address).toBeDefined();
      expect(JSON.stringify(rows)).not.toContain("192.0.2.1");
      if (address) await ctx.db.patch(address._id, { count: INGEST_LIMITS.requestsPerAddressPerMinute });
    });
    expect(await visitor.mutation(api.ingest.admit, { kind: "replay" })).toBe(false);
    expect(await t.withRequestMetadata({ ip: "192.0.2.2" }).mutation(api.ingest.admit, { kind: "replay" })).toBe(true);
    vi.setSystemTime(Date.now() + MINUTE);
    expect(await visitor.mutation(api.ingest.admit, { kind: "events" })).toBe(true);
  });

  it.each([
    ["requests:minute", "requestsPerMinute", MINUTE],
    ["requests:day", "requestsPerDay", DAY],
  ] as const)("stops all addresses when %s is full", async (key, limit, windowMs) => {
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const window = Math.floor(Date.now() / windowMs);
      await ctx.db.insert("counters", { key, window, count: INGEST_LIMITS[limit], expiresAt: (window + 1) * windowMs });
    });
    for (const kind of ["events", "replay"] as const) {
      expect(await t.withRequestMetadata({ ip: crypto.randomUUID() }).mutation(api.ingest.admit, { kind })).toBe(false);
    }
  });

  it.each([
    ["events", "events:minute", "eventsPerMinute", MINUTE],
    ["events", "events:day", "eventsPerDay", DAY],
    ["replay", "replay:chunks:minute", "replayChunksPerMinute", MINUTE],
    ["replay", "replay:bytes:day", "replayBytesPerDay", DAY],
  ] as const)("refuses %s admission when %s is full", async (kind, key, limit, windowMs) => {
    vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
    const t = convexTest(schema, modules);
    await t.run(async (ctx) => {
      const window = Math.floor(Date.now() / windowMs);
      await ctx.db.insert("counters", { key, window, count: INGEST_LIMITS[limit], expiresAt: (window + 1) * windowMs });
    });
    expect(await t.mutation(api.ingest.admit, { kind })).toBe(false);
    vi.setSystemTime(Date.now() + windowMs);
    expect(await t.mutation(api.ingest.admit, { kind })).toBe(true);
  });
});
