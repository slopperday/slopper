import { useState } from "react";
import { Form } from "react-router";
import { COST_CATEGORIES, type MoneyKind, REVENUE_CATEGORIES } from "~/lib/model";
import { Icon } from "./Icon";

export interface LedgerLine {
  id: string;
  kind: MoneyKind;
  amount: number;
  currency: string;
  category: string;
  note: string;
  date: string;
}
import { CURRENCIES, formatMoney, type MoneyTotal } from "~/lib/money";
import { formatDay } from "~/lib/dates";

function Totals({ totals }: { totals: readonly MoneyTotal[] }) {
  if (totals.length === 0) return <p className="mt-2 text-sm text-muted">Nothing logged yet.</p>;
  return (
    <dl className="mt-3 grid gap-3">
      {totals.map((total) => (
        <div key={total.currency} className="grid grid-cols-3 gap-3">
          <div>
            <dt className="text-sm text-muted">Spent</dt>
            <dd className="font-display text-[1.5rem] leading-tight font-extrabold tabular-nums">
              {formatMoney(total.spent, total.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Made</dt>
            <dd className="font-display text-[1.5rem] leading-tight font-extrabold tabular-nums">
              {formatMoney(total.made, total.currency)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted">Net</dt>
            <dd
              className={`font-display text-[1.5rem] leading-tight font-extrabold tabular-nums ${
                total.net >= 0 ? "text-slop-text" : "text-hot"
              }`}
            >
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
    <section aria-labelledby="public-money-title">
      <h2 id="public-money-title" className="caps">
        Building in public
      </h2>
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
  entries: readonly LedgerLine[];
  isPublic: boolean;
  today: string;
}) {
  const [kind, setKind] = useState<MoneyKind>("cost");
  const categories = kind === "cost" ? COST_CATEGORIES : REVENUE_CATEGORIES;
  return (
    <section id="money" aria-labelledby="money-ledger-title">
      <h2 id="money-ledger-title" className="caps">
        Money
      </h2>
      <p className="mt-1 text-[0.9375rem] text-muted">Costs and revenue across all its launches.</p>
      <Totals totals={totals} />

      <details className="mt-4">
        <summary className="flex min-h-11 items-center font-bold hover:text-slop-text">Log a cost or revenue</summary>
        <Form method="post" className="mt-3 grid gap-2" key={entries.length}>
          <input type="hidden" name="intent" value="money-add" />
          <fieldset className="inline-flex rounded-xl bg-sunk p-1">
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
                <span className="flex min-h-9 items-center justify-center rounded-lg px-3 text-[0.9375rem] font-bold text-muted peer-checked:bg-ink peer-checked:text-ground peer-focus-visible:outline-2 peer-focus-visible:outline-(--focus)">
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
        <ul className="mt-4 divide-y divide-line border-y border-line text-[0.9375rem]">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 py-1">
              <span className={`font-bold tabular-nums ${entry.kind === "cost" ? "text-hot" : "text-slop-text"}`}>
                {entry.kind === "cost" ? "−" : "+"}
                {formatMoney(entry.amount, entry.currency)}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted">
                {entry.note || entry.category} · {formatDay(entry.date)}
              </span>
              <Form method="post">
                <input type="hidden" name="intent" value="money-delete" />
                <input type="hidden" name="id" value={entry.id} />
                <button
                  type="submit"
                  className="-my-1 inline-flex size-11 items-center justify-center rounded-lg text-muted hover:bg-sunk hover:text-ink"
                  aria-label="Delete entry"
                >
                  <Icon name="close" className="size-4" />
                </button>
              </Form>
            </li>
          ))}
        </ul>
      )}

      <Form method="post" className="mt-4">
        <input type="hidden" name="intent" value="money-visibility" />
        <input type="hidden" name="public" value={isPublic ? "off" : "on"} />
        <button type="submit" className="min-h-11 text-[0.9375rem] font-bold underline hover:text-slop-text">
          {isPublic ? "Make these numbers private" : "Make these numbers public"}
        </button>
      </Form>
    </section>
  );
}
