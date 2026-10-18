import { addDays } from "~/lib/dates";
import { datesBetween, fetchJson, SourceError, type SyncInput, type SyncResult, unixDay, utcDate } from "./source";

/**
 * Stripe, read with a restricted key: Balance and Subscriptions, read only.
 * Revenue per day is gross customer payments less refunds and disputes, by
 * the balance's currency; MRR comes from active subscriptions.
 */

const API = "https://api.stripe.com/v1";
/** Pinned so the fields read here can't move under us. */
const STRIPE_VERSION = "2026-09-30.endive";
/** Enough for a small product's 90 days; a bigger one gets its newest payments. */
const MAX_PAGES = 20;

/** Restricted keys only: a full secret key can move money, and Slopper never needs to. */
export const STRIPE_KEY = /^rk_(live|test)_[A-Za-z0-9]{16,}$/;

/** Balance transactions that are customers paying, or giving it back. */
const REVENUE_CATEGORIES: ReadonlySet<string> = new Set([
  "charge",
  "refund",
  "dispute",
  "dispute_reversal",
  "partial_capture_reversal",
]);

interface StripeList<Item> {
  data: Item[];
  has_more: boolean;
}

interface BalanceTransaction {
  id: string;
  amount: number;
  currency: string;
  reporting_category: string;
  created: number;
}

interface Subscription {
  id: string;
  items: {
    data: {
      quantity?: number | null;
      price: {
        unit_amount: number | null;
        currency: string;
        recurring: { interval: "day" | "week" | "month" | "year"; interval_count: number } | null;
      };
    }[];
  };
}

function refused(status: number): string | null {
  if (status === 401) return "Stripe didn't accept that key. Make a new restricted key and paste it again.";
  if (status === 403)
    return "That key can't read everything it needs. Give it read access to Balance and Subscriptions.";
  return null;
}

async function list<Item extends { id: string }>(
  input: SyncInput,
  path: string,
  params: Record<string, string>,
): Promise<{ items: Item[]; complete: boolean }> {
  const items: Item[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(`${API}/${path}`);
    for (const [key, value] of Object.entries({ ...params, limit: "100" })) url.searchParams.set(key, value);
    if (after) url.searchParams.set("starting_after", after);
    const body = (await fetchJson(
      input.fetcher,
      url,
      { headers: { authorization: `Bearer ${input.secret}`, "stripe-version": STRIPE_VERSION } },
      refused,
    )) as StripeList<Item>;
    items.push(...body.data);
    if (!body.has_more || body.data.length === 0) return { items, complete: true };
    after = body.data[body.data.length - 1].id;
  }
  return { items, complete: false };
}

/** One subscription item's monthly amount, in minor units. Metered and tiered prices have no fixed amount. */
export function monthlyAmount(item: Subscription["items"]["data"][number]): number {
  const { unit_amount: unit, recurring } = item.price;
  if (unit === null || !recurring) return 0;
  const perInterval = unit * (item.quantity ?? 1);
  const months = { day: 12 / 365, week: 12 / 52, month: 1, year: 12 }[recurring.interval] * recurring.interval_count;
  return perInterval / months;
}

export async function syncStripe(input: SyncInput): Promise<SyncResult> {
  if (!input.secret) throw new SourceError("Paste a restricted key to connect Stripe.");
  const [payments, subscriptions] = await Promise.all([
    list<BalanceTransaction>(input, "balance_transactions", { "created[gte]": String(unixDay(input.since)) }),
    list<Subscription>(input, "subscriptions", { status: "active" }),
  ]);

  const revenue = new Map<string, Record<string, number>>();
  for (const payment of payments.items) {
    if (!REVENUE_CATEGORIES.has(payment.reporting_category)) continue;
    const date = utcDate(payment.created);
    const day = revenue.get(date) ?? {};
    const currency = payment.currency.toUpperCase();
    day[currency] = (day[currency] ?? 0) + payment.amount;
    revenue.set(date, day);
  }
  // Paging stopped early: the oldest day it reached is partial, so only the days after it are counted.
  const oldest = payments.complete
    ? input.since
    : addDays(utcDate(Math.min(...payments.items.map((payment) => payment.created))), 1);
  const mrr: Record<string, number> = {};
  for (const subscription of subscriptions.items) {
    for (const item of subscription.items.data) {
      const currency = item.price.currency.toUpperCase();
      mrr[currency] = (mrr[currency] ?? 0) + monthlyAmount(item);
    }
  }
  for (const currency of Object.keys(mrr)) mrr[currency] = Math.round(mrr[currency]);

  return {
    merge: "replace",
    days: datesBetween(oldest, input.today).map((date) => ({ date, revenue: revenue.get(date) ?? {} })),
    live: null,
    snapshot: { mrr, subscribers: subscriptions.items.length },
    cursor: null,
  };
}
