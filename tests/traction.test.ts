import { describe, expect, it } from "vite-plus/test";
import { LIVE_FRESH_MS, type DayNumbers, type Traction, type TractionSource } from "~/lib/integrations";
import { BOARD_DAYS, MILESTONES, nextMilestone, tractionBoard } from "~/lib/traction";

const today = "2026-10-10";
const now = Date.parse("2026-10-10T12:00:00Z");

function source(overrides: Partial<TractionSource> & Pick<TractionSource, "id" | "provider" | "kind">): TractionSource {
  return {
    label: null,
    public: true,
    status: "ok",
    error: null,
    syncedAt: now - 60_000,
    live: null,
    snapshot: {},
    ...overrides,
  };
}

const ga = (overrides: Partial<TractionSource> = {}) =>
  source({ id: "ga", provider: "ga4", kind: "analytics", ...overrides });
const posthog = (overrides: Partial<TractionSource> = {}) =>
  source({ id: "ph", provider: "posthog", kind: "analytics", ...overrides });
const stripe = (overrides: Partial<TractionSource> = {}) =>
  source({ id: "stripe", provider: "stripe", kind: "payments", ...overrides });
const solana = (overrides: Partial<TractionSource> = {}) =>
  source({ id: "sol", provider: "solana", kind: "payments", ...overrides });

function traction(sources: TractionSource[], days: (DayNumbers & { sourceId: string })[] = []): Traction {
  return { sources, days };
}

function board(value: Traction) {
  const result = tractionBoard(value, today, now);
  if (!result) throw new Error("Expected a board.");
  return result;
}

describe("the next milestone", () => {
  it("is the first round number above the people so far", () => {
    expect(nextMilestone(0)).toEqual({ target: 10, remaining: 10 });
    expect(nextMilestone(9)).toEqual({ target: 10, remaining: 1 });
    expect(nextMilestone(962)).toEqual({ target: 1_000, remaining: 38 });
    expect(nextMilestone(55_000)).toEqual({ target: 100_000, remaining: 45_000 });
  });

  it("moves on once a milestone is reached", () => {
    expect(nextMilestone(10)).toEqual({ target: 100, remaining: 90 });
    expect(nextMilestone(1_000)).toEqual({ target: 10_000, remaining: 9_000 });
  });

  it("runs out after the last milestone", () => {
    const last = MILESTONES[MILESTONES.length - 1];
    expect(nextMilestone(last - 1)).toEqual({ target: last, remaining: 1 });
    expect(nextMilestone(last)).toBeNull();
    expect(nextMilestone(last * 2)).toBeNull();
  });
});

describe("the traction board", () => {
  it("is empty without a synced source", () => {
    expect(tractionBoard(traction([]), today, now)).toBeNull();
    expect(tractionBoard(traction([ga({ syncedAt: null, status: "pending" })]), today, now)).toBeNull();
    expect(tractionBoard(traction([ga({ syncedAt: null }), stripe({ syncedAt: null })]), today, now)).toBeNull();
  });

  it("covers exactly the last 30 days ending today, filling empty days with zero", () => {
    const result = board(
      traction(
        [ga()],
        [
          { sourceId: "ga", date: today, people: 5, signups: 1 },
          { sourceId: "ga", date: "2026-09-11", people: 2, signups: 0 },
          // Outside the window, in either direction.
          { sourceId: "ga", date: "2026-09-10", people: 99, signups: 99 },
          { sourceId: "ga", date: "2026-10-11", people: 99, signups: 99 },
        ],
      ),
    );
    expect(result.days).toHaveLength(BOARD_DAYS);
    expect(result.days[0]).toEqual({ date: "2026-09-11", people: 2, signups: 0, revenue: null });
    expect(result.days.at(-1)).toEqual({ date: today, people: 5, signups: 1, revenue: null });
    expect(result.days.find((day) => day.date === "2026-09-20")).toMatchObject({ people: 0, signups: 0 });
    expect(result.signups?.days30).toBe(1);
  });

  it("reads people and signups from the first analytics source only", () => {
    const result = board(
      traction(
        [ga(), posthog()],
        [
          { sourceId: "ga", date: today, people: 5, signups: 2 },
          { sourceId: "ph", date: today, people: 50, signups: 20 },
        ],
      ),
    );
    expect(result.people?.today).toBe(5);
    expect(result.signups?.today).toBe(2);
    expect(result.people?.via.providers).toEqual(["ga4"]);
  });

  it("skips an analytics source that hasn't synced yet", () => {
    const result = board(
      traction(
        [ga({ syncedAt: null, status: "pending" }), posthog()],
        [{ sourceId: "ph", date: today, people: 8, signups: 0 }],
      ),
    );
    expect(result.people?.via.providers).toEqual(["posthog"]);
    expect(result.people?.today).toBe(8);
  });

  it("leaves people and signups out when there are only payment sources", () => {
    const result = board(traction([stripe()], [{ sourceId: "stripe", date: today, revenue: { USD: 500 } }]));
    expect(result.people).toBeNull();
    expect(result.signups).toBeNull();
    expect(result.live).toBeNull();
    expect(result.best).toBeNull();
    expect(result.next).toBeNull();
    expect(result.days.every((day) => day.people === null && day.signups === null)).toBe(true);
  });

  it("adds revenue from two payment sources currency by currency", () => {
    const result = board(
      traction(
        [stripe(), solana()],
        [
          { sourceId: "stripe", date: today, revenue: { USD: 1000, EUR: 300 } },
          { sourceId: "sol", date: today, revenue: { USD: 250 } },
          { sourceId: "stripe", date: "2026-10-09", revenue: { USD: 400 } },
        ],
      ),
    );
    expect(result.revenue?.today).toEqual([
      { currency: "USD", amount: 1250 },
      { currency: "EUR", amount: 300 },
    ]);
    expect(result.revenue?.days30).toEqual([
      { currency: "USD", amount: 1650 },
      { currency: "EUR", amount: 300 },
    ]);
    expect(result.revenue?.via.providers).toEqual(["stripe", "solana"]);
  });

  it("charts the currency with the most revenue", () => {
    const result = board(
      traction(
        [stripe()],
        [
          { sourceId: "stripe", date: today, revenue: { USD: 100, EUR: 900 } },
          { sourceId: "stripe", date: "2026-10-09", revenue: { USD: 200 } },
        ],
      ),
    );
    expect(result.currency).toBe("EUR");
    expect(result.days.at(-1)?.revenue).toBe(900);
    expect(result.days.at(-2)?.revenue).toBe(0);
  });

  it("falls back to dollars when payments are connected but nothing was earned", () => {
    const result = board(traction([stripe()]));
    expect(result.currency).toBe("USD");
    expect(result.revenue).toMatchObject({ today: [], days30: [] });
    expect(result.days.every((day) => day.revenue === 0)).toBe(true);
  });

  it("has no currency or revenue without payment sources", () => {
    const result = board(traction([ga()]));
    expect(result.currency).toBeNull();
    expect(result.revenue).toBeNull();
    expect(result.days.every((day) => day.revenue === null)).toBe(true);
  });

  it("ignores revenue rows from analytics sources and from payment sources that haven't synced", () => {
    const result = board(
      traction(
        [ga(), stripe(), solana({ syncedAt: null, status: "pending" })],
        [
          { sourceId: "ga", date: today, people: 1, revenue: { USD: 777 } },
          { sourceId: "sol", date: today, revenue: { USD: 888 } },
          { sourceId: "stripe", date: today, revenue: { USD: 100 } },
        ],
      ),
    );
    expect(result.revenue?.today).toEqual([{ currency: "USD", amount: 100 }]);
    expect(result.revenue?.via.providers).toEqual(["stripe"]);
  });

  it("shows who is on it now only while the count is fresh", () => {
    const live = (age: number) => ({ people: 7, at: now - age });
    expect(board(traction([ga({ live: live(60_000) })])).live).toMatchObject({ people: 7 });
    expect(board(traction([ga({ live: live(LIVE_FRESH_MS - 1) })])).live).toMatchObject({ people: 7 });
    expect(board(traction([ga({ live: live(LIVE_FRESH_MS) })])).live).toBeNull();
    expect(board(traction([ga({ live: live(2 * LIVE_FRESH_MS) })])).live).toBeNull();
    expect(board(traction([ga({ live: null })])).live).toBeNull();
  });

  it("finds the best day by people, earliest first on a tie, ignoring empty days", () => {
    const result = board(
      traction(
        [ga()],
        [
          { sourceId: "ga", date: "2026-10-01", people: 12 },
          { sourceId: "ga", date: "2026-10-05", people: 30 },
          { sourceId: "ga", date: "2026-10-07", people: 30 },
          { sourceId: "ga", date: "2026-10-08", people: 0 },
        ],
      ),
    );
    expect(result.best).toEqual({ date: "2026-10-05", people: 30 });
  });

  it("has no best day when nobody came", () => {
    expect(board(traction([ga()])).best).toBeNull();
  });

  it("works out the next milestone from the 30-day people count", () => {
    const result = board(traction([ga({ snapshot: { people30: 962 } })]));
    expect(result.people?.days30).toBe(962);
    expect(result.next).toEqual({ target: 1_000, remaining: 38 });
  });

  it("has no milestone or 30-day count when the source didn't report one", () => {
    const result = board(traction([ga()]));
    expect(result.people?.days30).toBeNull();
    expect(result.next).toBeNull();
  });

  it("sums monthly recurring revenue and subscribers across payment sources", () => {
    const result = board(
      traction([
        stripe({ snapshot: { mrr: { USD: 4000, EUR: 500 }, subscribers: 4 } }),
        stripe({ id: "stripe-2", snapshot: { mrr: { USD: 1000 }, subscribers: 2 } }),
      ]),
    );
    expect(result.mrr).toEqual({
      amounts: [
        { currency: "USD", amount: 5000 },
        { currency: "EUR", amount: 500 },
      ],
      subscribers: 6,
      via: { providers: ["stripe", "stripe"], syncedAt: now - 60_000 },
    });
  });

  it("has no recurring revenue when no payment source reports it", () => {
    expect(board(traction([stripe(), solana()])).mrr).toBeNull();
    expect(board(traction([ga({ snapshot: { mrr: { USD: 100 } } })])).mrr).toBeNull();
  });

  it("dates a number by the oldest sync behind it", () => {
    const result = board(traction([stripe({ syncedAt: now - 120_000 }), solana({ syncedAt: now - 30_000 })]));
    expect(result.revenue?.via.syncedAt).toBe(now - 120_000);
  });
});
