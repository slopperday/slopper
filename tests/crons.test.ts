import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { api, internal } from "@convex/_generated/api";
import { convexApp } from "./convexApp";

const DAY = 86_400_000;
const START = Date.UTC(2026, 9, 20);

describe("expired rate-limit cleanup", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("leaves a full live page alone without scheduling another sweep", async () => {
    const t = convexApp();
    await t.run(async (ctx) => {
      for (let i = 0; i < 500; i++) {
        await ctx.db.insert("rateLimits", { key: `live:${i}`, window: Math.floor(START / DAY), count: 1 });
      }
    });

    await t.mutation(internal.crons.sweep, {});

    const { windows, jobs } = await t.run(async (ctx) => ({
      windows: await ctx.db.query("rateLimits").collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(windows).toHaveLength(500);
    expect(jobs).toHaveLength(0);

    const server = t.withIdentity({ subject: "server" });
    expect(await server.mutation(api.limits.hit, { key: "live:0", limit: 1, windowMs: DAY })).toBe(false);
    vi.setSystemTime(START + DAY);
    expect(await server.mutation(api.limits.hit, { key: "live:0", limit: 1, windowMs: DAY })).toBe(true);
  });

  it("keeps rows at the two-day boundary and deletes only older rows", async () => {
    const t = convexApp();
    const expired = await t.run(async (ctx) => {
      return await ctx.db.insert("rateLimits", { key: "expired", window: 1, count: 1 });
    });
    vi.setSystemTime(START + 1);
    const boundary = await t.run(async (ctx) => {
      return await ctx.db.insert("rateLimits", { key: "boundary", window: 1, count: 1 });
    });
    vi.setSystemTime(START + 2 * DAY + 1);

    await t.mutation(internal.crons.sweep, {});

    expect(await t.run(async (ctx) => await ctx.db.get(expired))).toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.get(boundary))).not.toBeNull();
    expect(await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(0);
  });

  it.each([500, 501, 1201])("drains %i expired rows in bounded pages and stops at a full live page", async (count) => {
    const t = convexApp();
    await t.run(async (ctx) => {
      for (let i = 0; i < count; i++) {
        await ctx.db.insert("rateLimits", { key: `expired:${i}`, window: 1, count: 1 });
      }
    });
    vi.setSystemTime(START + 3 * DAY);
    await t.run(async (ctx) => {
      for (let i = 0; i < 500; i++) {
        await ctx.db.insert("rateLimits", { key: `live:${i}`, window: 2, count: 1 });
      }
    });

    await t.mutation(internal.crons.sweep, {});

    expect(await t.run(async (ctx) => await ctx.db.query("rateLimits").collect())).toHaveLength(count);
    expect(await t.run(async (ctx) => await ctx.db.system.query("_scheduled_functions").collect())).toHaveLength(1);

    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const { windows, jobs } = await t.run(async (ctx) => ({
      windows: await ctx.db.query("rateLimits").collect(),
      jobs: await ctx.db.system.query("_scheduled_functions").collect(),
    }));
    expect(windows).toHaveLength(500);
    expect(windows.every((row) => row.key.startsWith("live:"))).toBe(true);
    expect(jobs).toHaveLength(Math.floor(count / 500));
    expect(jobs.every((job) => job.state.kind === "success")).toBe(true);
  });
});
