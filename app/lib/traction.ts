import { addDays } from "./dates";
import {
  addRevenue,
  type IntegrationProvider,
  LIVE_FRESH_MS,
  type Traction,
  type TractionSource,
} from "./integrations";

/**
 * Turns a product's sources and their days into the traction board: what's
 * on it now, today and the last 30 days, and the day-by-day strip.
 *
 * Analytics sources overlap (two of them count the same people), so one is
 * read: the first connected. Payment sources don't (a card and a wallet are
 * different money), so their revenue adds up.
 */

export const BOARD_DAYS = 30;

/** Round numbers worth reaching: people in 30 days. */
export const MILESTONES = [10, 100, 1_000, 10_000, 100_000, 1_000_000] as const;

export interface Money {
  currency: string;
  amount: number;
}

export interface Via {
  providers: IntegrationProvider[];
  /** The oldest sync behind the number, so "synced 3m ago" is never optimistic. */
  syncedAt: number;
}

export interface BoardDay {
  date: string;
  people: number | null;
  signups: number | null;
  /** In the board's main currency. */
  revenue: number | null;
}

export interface TractionBoard {
  live: { people: number; via: Via } | null;
  people: { today: number; days30: number | null; via: Via } | null;
  signups: { today: number; days30: number; via: Via } | null;
  revenue: { today: Money[]; days30: Money[]; via: Via } | null;
  mrr: { amounts: Money[]; subscribers: number | null; via: Via } | null;
  /** The main currency: the one with the most revenue in 30 days. */
  currency: string | null;
  days: BoardDay[];
  best: { date: string; people: number } | null;
  /** The next round number of people in 30 days. */
  next: { target: number; remaining: number } | null;
}

function via(sources: readonly TractionSource[]): Via {
  return {
    providers: sources.map((source) => source.provider),
    syncedAt: Math.min(...sources.map((source) => source.syncedAt ?? 0)),
  };
}

function money(totals: Record<string, number>): Money[] {
  return Object.entries(totals)
    .filter(([, amount]) => amount !== 0)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);
}

export function nextMilestone(people: number): { target: number; remaining: number } | null {
  const target = MILESTONES.find((milestone) => milestone > people);
  return target ? { target, remaining: target - people } : null;
}

export function tractionBoard(traction: Traction, today: string, now: number): TractionBoard | null {
  const ready = traction.sources.filter((source) => source.syncedAt !== null);
  const analytics = ready.find((source) => source.kind === "analytics") ?? null;
  const payments = ready.filter((source) => source.kind === "payments");
  if (!analytics && payments.length === 0) return null;

  const since = addDays(today, -(BOARD_DAYS - 1));
  const window = traction.days.filter((day) => day.date >= since && day.date <= today);
  const analyticsDays = new Map(
    window.filter((day) => day.sourceId === analytics?.id).map((day) => [day.date, day] as const),
  );
  const paymentIds = new Set(payments.map((source) => source.id));
  const revenueByDay = new Map<string, Record<string, number>>();
  for (const day of window) {
    if (!paymentIds.has(day.sourceId)) continue;
    revenueByDay.set(day.date, addRevenue({ ...revenueByDay.get(day.date) }, day.revenue));
  }
  const revenue30: Record<string, number> = {};
  for (const totals of revenueByDay.values()) addRevenue(revenue30, totals);
  const currency = money(revenue30)[0]?.currency ?? (payments.length > 0 ? "USD" : null);

  const days: BoardDay[] = [];
  for (let date = since; date <= today; date = addDays(date, 1)) {
    const numbers = analyticsDays.get(date);
    days.push({
      date,
      people: analytics ? (numbers?.people ?? 0) : null,
      signups: analytics ? (numbers?.signups ?? 0) : null,
      revenue: currency ? (revenueByDay.get(date)?.[currency] ?? 0) : null,
    });
  }

  const mrrSources = payments.filter((source) => source.snapshot.mrr);
  const mrr: Record<string, number> = {};
  for (const source of mrrSources) addRevenue(mrr, source.snapshot.mrr);
  const fresh = analytics?.live && now - analytics.live.at < LIVE_FRESH_MS ? analytics.live : null;
  const people30 = analytics?.snapshot.people30 ?? null;
  const best = analytics
    ? days.reduce<{ date: string; people: number } | null>(
        (top, day) => (day.people && (!top || day.people > top.people) ? { date: day.date, people: day.people } : top),
        null,
      )
    : null;

  return {
    live: analytics && fresh ? { people: fresh.people, via: via([analytics]) } : null,
    people: analytics ? { today: days.at(-1)?.people ?? 0, days30: people30, via: via([analytics]) } : null,
    signups: analytics
      ? {
          today: days.at(-1)?.signups ?? 0,
          days30: days.reduce((sum, day) => sum + (day.signups ?? 0), 0),
          via: via([analytics]),
        }
      : null,
    revenue:
      payments.length > 0
        ? { today: money(revenueByDay.get(today) ?? {}), days30: money(revenue30), via: via(payments) }
        : null,
    mrr:
      mrrSources.length > 0
        ? {
            amounts: money(mrr),
            subscribers: mrrSources.reduce((sum, source) => sum + (source.snapshot.subscribers ?? 0), 0),
            via: via(mrrSources),
          }
        : null,
    currency,
    days,
    best,
    next: people30 === null ? null : nextMilestone(people30),
  };
}
