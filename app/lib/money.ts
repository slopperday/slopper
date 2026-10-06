import type { LedgerEntry } from "./model";

/** Money helpers shared by the server and the slop page. */

export const CURRENCIES = ["USD", "EUR", "GBP", "NGN", "CAD", "AUD", "INR", "JPY", "USDC", "SOL"] as const;

/** Currencies that aren't ISO 4217, formatted by hand. */
const CRYPTO: Record<string, { symbol: string; decimals: number }> = {
  USDC: { symbol: "USDC", decimals: 2 },
  SOL: { symbol: "SOL", decimals: 2 },
};

export function formatMoney(amount: number, currency: string): string {
  const crypto = CRYPTO[currency];
  if (crypto) return `${(amount / 100).toFixed(crypto.decimals)} ${crypto.symbol}`;
  return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 2 }).format(amount / 100);
}

/** "12.99" or "12,99" → 1299. Null when it isn't a positive amount. */
export function parseAmount(text: string): number | null {
  const normalized = text
    .trim()
    .replace(/[\s,](?=\d{3}\b)/g, "")
    .replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  const cents = Math.round(Number(normalized) * 100);
  return cents > 0 && cents < 1e12 ? cents : null;
}

export interface MoneyTotal {
  currency: string;
  spent: number;
  made: number;
  net: number;
}

export function moneyTotals(entries: readonly Pick<LedgerEntry, "kind" | "amount" | "currency">[]): MoneyTotal[] {
  const byCurrency = new Map<string, MoneyTotal>();
  for (const entry of entries) {
    const total = byCurrency.get(entry.currency) ?? { currency: entry.currency, spent: 0, made: 0, net: 0 };
    if (entry.kind === "cost") total.spent += entry.amount;
    else total.made += entry.amount;
    total.net = total.made - total.spent;
    byCurrency.set(entry.currency, total);
  }
  return [...byCurrency.values()];
}
