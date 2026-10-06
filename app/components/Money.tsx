import { useState } from "react";
import { Form } from "react-router";
import { COST_CATEGORIES, type LedgerEntry, type MoneyKind, REVENUE_CATEGORIES } from "~/lib/model";
import { CURRENCIES, formatMoney, type MoneyTotal } from "~/lib/money";
import { formatDay } from "~/lib/dates";

function Totals({ totals }: { totals: readonly MoneyTotal[] }) {
  if (totals.length === 0) return <p className="mt-2 text-sm text-muted">Nothing logged yet.</p>;
  return (
    <dl className="mt-3 grid gap-2">
      {totals.map((total) => (
        <div key={total.currency} className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-lg bg-wall-deep px-2 py-1.5">
            <dt className="eyebrow">Spent</dt>
            <dd className="font-bold tabular-nums">{formatMoney(total.spent, total.currency)}</dd>
          </div>
          <div className="rounded-lg bg-wall-deep px-2 py-1.5">
            <dt className="eyebrow">Made</dt>
            <dd className="font-bold tabular-nums">{formatMoney(total.made, total.currency)}</dd>
          </div>
          <div className={`rounded-lg px-2 py-1.5 ${total.net >= 0 ? "bg-slop text-slop-ink" : "bg-hot text-white"}`}>
            <dt className="font-mono text-[0.6875rem] tracking-[0.08em] uppercase">Net</dt>
            <dd className="font-bold tabular-nums">
              {total.net >= 0 ? "+" : "−"}
              {formatMoney(Math.abs(total.net), total.currency)}
            </dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

/** Public view: the numbers, if the owner chose to share them. */
export function MoneySummary({ totals }: { totals: readonly MoneyTotal[] }) {
  return (
    <section className="rounded-2xl border-2 border-ink bg-card p-5">
      <h2 className="eyebrow">Building in public</h2>
      <Totals totals={totals} />
    </section>
  );
}

/** Owner view: log costs and revenue, and choose whether to show them. */
export function MoneyLedger({
  totals,
  entries,
  isPublic,
  today,
}: {
  totals: readonly MoneyTotal[];
  entries: readonly LedgerEntry[];
  isPublic: boolean;
  today: string;
}) {
  const [kind, setKind] = useState<MoneyKind>("cost");
  const categories = kind === "cost" ? COST_CATEGORIES : REVENUE_CATEGORIES;
  return (
    <section id="money" className="scroll-mt-24 rounded-2xl border-2 border-ink bg-card p-5">
      <h2 className="eyebrow">Money</h2>
      <p className="mt-1 text-sm text-muted">What this product cost and what it made, across all its launches.</p>
      <Totals totals={totals} />

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-bold">Log a cost or revenue</summary>
        <Form method="post" className="mt-3 grid gap-2" key={entries.length}>
          <input type="hidden" name="intent" value="money-add" />
          <fieldset className="inline-flex rounded-full border-2 border-ink bg-wall p-0.5">
            <legend className="sr-only">Cost or revenue</legend>
            {(["cost", "revenue"] as const).map((option) => (
              <label key={option} className="flex-1 cursor-pointer">
                <input
                  type="radio"
                  name="kind"
                  value={option}
                  checked={kind === option}
                  onChange={() => setKind(option)}
                  className="peer sr-only"
                />
                <span className="block rounded-full px-3 py-1 text-center font-mono text-[0.68rem] tracking-wider uppercase peer-checked:bg-ink peer-checked:text-wall">
                  {option === "cost" ? "Spent" : "Made"}
                </span>
              </label>
            ))}
          </fieldset>
          <div className="grid grid-cols-[1fr_5.5rem] gap-2">
            <input
              name="amount"
              inputMode="decimal"
              required
              className="input"
              placeholder="12.99"
              aria-label="Amount"
            />
            <select name="currency" className="input" aria-label="Currency" defaultValue="USD">
              {CURRENCIES.map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <select name="category" className="input" aria-label="Category" key={kind}>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
            <input name="date" type="date" className="input" defaultValue={today} max={today} aria-label="Date" />
          </div>
          <input
            name="note"
            className="input"
            maxLength={120}
            placeholder={kind === "cost" ? "Domain on Porkbun" : "First 3 subscribers"}
            aria-label="Note"
          />
          <button type="submit" className="btn btn-sm justify-self-start">
            Log it
          </button>
        </Form>
      </details>

      {entries.length > 0 && (
        <ul className="mt-4 grid gap-1.5 text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2">
              <span className={entry.kind === "cost" ? "text-hot" : "text-slop-deep"}>
                {entry.kind === "cost" ? "−" : "+"}
                {formatMoney(entry.amount, entry.currency)}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted">
                {entry.note || entry.category} · {formatDay(entry.date)}
              </span>
              <Form method="post">
                <input type="hidden" name="intent" value="money-delete" />
                <input type="hidden" name="id" value={entry.id} />
                <button type="submit" className="text-xs text-muted underline" aria-label="Delete entry">
                  ✕
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}

      <Form method="post" className="mt-4">
        <input type="hidden" name="intent" value="money-visibility" />
        <input type="hidden" name="public" value={isPublic ? "off" : "on"} />
        <button type="submit" className="text-xs underline">
          {isPublic ? "Hide these numbers from everyone else" : "Show these numbers publicly"}
        </button>
      </Form>
    </section>
  );
}
