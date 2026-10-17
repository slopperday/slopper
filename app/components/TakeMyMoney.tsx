import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { PLEDGE_PRESETS } from "~/lib/model";
import { formatMoney } from "~/lib/money";

interface PledgeState {
  backers: number;
  pledged: number;
  amount: number;
  error: string | null;
}

/**
 * "Shut up and take my money." People pledge what they'd pay, which shows
 * the maker how much anyone actually wants it. Non-binding until payments
 * exist, and said so plainly.
 */
export function TakeMyMoney({
  slopId,
  backers,
  pledged,
  myPledge,
  mode,
  loginHref,
}: {
  slopId: string;
  backers: number;
  pledged: number;
  myPledge: number;
  mode: "vote" | "login" | "own";
  loginHref: string;
}) {
  const fetcher = useFetcher<PledgeState>();
  const [open, setOpen] = useState(false);
  const state =
    fetcher.data && !fetcher.data.error ? fetcher.data : { backers, pledged, amount: myPledge, error: null };
  const pending = fetcher.state !== "idle";

  return (
    <section aria-labelledby="money-title">
      <h2 id="money-title" className="sr-only">
        Take my money
      </h2>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-[2.75rem] leading-none font-black tabular-nums">
          {formatMoney(state.pledged, "USD")}
        </span>
        <span className="text-muted">
          pledged by {state.backers} {state.backers === 1 ? "person" : "people"}
        </span>
      </p>
      {mode === "own" ? (
        <p className="mt-2 text-[0.9375rem] text-muted">What people say they'd pay. Share it to find out.</p>
      ) : mode === "login" ? (
        <Link to={loginHref} className="btn btn-ink mt-4 w-full">
          💸 Take my money
        </Link>
      ) : (
        <>
          {state.amount > 0 && !open ? (
            <p className="mt-3">
              You pledged <strong>{formatMoney(state.amount, "USD")}</strong>.{" "}
              <button type="button" className="link" onClick={() => setOpen(true)}>
                Change
              </button>
            </p>
          ) : !open ? (
            <button type="button" className="btn btn-ink mt-4 w-full" onClick={() => setOpen(true)}>
              💸 Take my money
            </button>
          ) : null}
          {open && (
            <fetcher.Form
              method="post"
              action={`/api/slops/${slopId}/pledge`}
              className="mt-4 grid gap-2"
              onSubmit={() => setOpen(false)}
            >
              <div className="grid grid-cols-3 gap-2">
                {PLEDGE_PRESETS.map((preset) => (
                  <button
                    key={preset}
                    type="submit"
                    name="amount"
                    value={String(preset / 100)}
                    className="btn btn-sm"
                    disabled={pending}
                  >
                    {formatMoney(preset, "USD")}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <label htmlFor={`pledge-${slopId}`} className="sr-only">
                  Custom amount in US dollars
                </label>
                <input
                  id={`pledge-${slopId}`}
                  name="custom"
                  inputMode="decimal"
                  className="input"
                  placeholder="Other amount, $"
                />
                <button type="submit" className="btn btn-ink" disabled={pending}>
                  Pledge
                </button>
              </div>
              {state.amount > 0 && (
                <button
                  type="submit"
                  name="amount"
                  value="0"
                  className="min-h-11 justify-self-start text-sm text-muted underline hover:text-ink"
                >
                  Withdraw my pledge
                </button>
              )}
            </fetcher.Form>
          )}
          {fetcher.data?.error && (
            <p className="field-error" role="alert">
              {fetcher.data.error}
            </p>
          )}
        </>
      )}
      <p className="mt-3 text-sm text-muted">Pledges are non-binding. No money moves yet.</p>
    </section>
  );
}
