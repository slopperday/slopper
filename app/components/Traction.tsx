import { useEffect, useRef } from "react";
import { Link, useFetcher } from "react-router";
import { formatDay, timeAgo } from "~/lib/dates";
import { INTEGRATIONS, SYNC_EVERY_MS, type Traction } from "~/lib/integrations";
import { type BoardDay, type Money, type TractionBoard, tractionBoard, type Via } from "~/lib/traction";
import { Icon } from "./Icon";
import { Tiles, useHydrated } from "./Tiles";

/**
 * Traction on the board: the product's real numbers, read from the sources
 * its maker connected, each labelled with where it came from. While the page
 * is open it asks for fresh numbers when they go stale, and the live query
 * flips the tiles as they land.
 */

/** Whole units for tiles: "$412", "€1,284". */
export function wholeMoney({ amount, currency }: Money): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency, maximumFractionDigits: 0 }).format(amount / 100);
  } catch {
    return `${Math.round(amount / 100).toLocaleString("en")} ${currency}`;
  }
}

/** Counts short enough for a row of tiles: 1,284 · 12.4k · 1.2m. */
export function shortCount(value: number): string {
  if (value < 10_000) return value.toLocaleString("en");
  if (value < 1_000_000) return `${Number((value / 1000).toFixed(value < 100_000 ? 1 : 0))}k`;
  return `${Number((value / 1_000_000).toFixed(1))}m`;
}

export function syncedLabel(syncedAt: number): string {
  const ago = timeAgo(syncedAt);
  return ago === "now" ? "synced just now" : `synced ${ago} ago`;
}

function ViaLine({ via, note }: { via: Via; note?: string }) {
  const hydrated = useHydrated();
  const names = [...new Set(via.providers)].map((provider) => INTEGRATIONS[provider].label).join(" + ");
  return (
    <p className="flex items-start gap-1.5 text-sm text-board-muted">
      <Icon name="check" className="mt-0.5 size-3.5" />
      <span>
        via {names}
        {note ? ` ${note}` : ""}
        {/* Relative times differ between server and browser, so they appear once the page is live. */}
        {hydrated && via.syncedAt > 0 ? ` · ${syncedLabel(via.syncedAt)}` : ""}
      </span>
    </p>
  );
}

function moneyText(amounts: readonly Money[]): string {
  return amounts.length === 0 ? "$0" : amounts.map(wholeMoney).join(" + ");
}

function Value({ label, value, hidden }: { label: string; value: string | null; hidden: boolean }) {
  return (
    <dd className="min-w-0">
      <span className={`caps block text-[0.75rem] text-board-muted ${hidden ? "@[36rem]:sr-only" : ""}`}>{label}</span>
      {value === null ? (
        <span className="text-board-muted">—</span>
      ) : (
        <>
          <Tiles value={value} className="text-[1.75rem]" />
          <span className="sr-only">
            {value} {label.toLowerCase()}
          </span>
        </>
      )}
    </dd>
  );
}

/**
 * One number on the board: today and the last 30 days, or (for a rate like
 * MRR, with `days30` left out) a single figure under its own label.
 */
function Row({
  label,
  today,
  days30,
  todayLabel = "Today",
  via,
  note,
}: {
  label: string;
  today: string;
  days30?: string | null;
  todayLabel?: string;
  via: Via;
  note?: string;
}) {
  const single = days30 === undefined;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-2 py-4 @[36rem]:grid-cols-[7.5rem_minmax(0,7rem)_minmax(0,1fr)_minmax(0,13rem)] @[36rem]:items-center">
      <dt className="col-span-2 font-display text-[1.25rem] font-extrabold uppercase @[36rem]:col-span-1">{label}</dt>
      {/* A single figure keeps its label on wide boards: the column heads say Today and 30 days. */}
      <Value label={todayLabel} value={today} hidden={!single} />
      {single ? <dd aria-hidden="true" /> : <Value label="30 days" value={days30} hidden />}
      <dd className="col-span-2 @[36rem]:col-span-1">
        <ViaLine via={via} note={note} />
      </dd>
    </div>
  );
}

/** Thirty days as tiles: the digits are the day's number, the fill is how it stacks up. */
function Strip({ days, pick, unit }: { days: BoardDay[]; pick: (day: BoardDay) => number; unit: string }) {
  const values = days.map(pick);
  const top = Math.max(1, ...values);
  return (
    <ol className="mt-3 grid grid-cols-10 gap-1 @[30rem]:grid-cols-15 @[56rem]:grid-cols-30">
      {days.map((day, index) => {
        const value = values[index];
        return (
          <li
            key={day.date}
            className="relative grid h-12 place-items-center overflow-hidden rounded-[0.2rem] bg-tile font-display text-[0.9rem] font-extrabold tabular-nums"
            aria-label={`${formatDay(day.date)}: ${value.toLocaleString("en")} ${unit}`}
          >
            <span
              aria-hidden="true"
              className="absolute inset-x-0 bottom-0 bg-board-ink/25"
              style={{ height: `${Math.round((value / top) * 100)}%` }}
            />
            <span aria-hidden="true" className={`relative ${value === 0 ? "text-board-muted" : ""}`}>
              {value === 0 ? "·" : shortCount(value)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function Board({ board, owner }: { board: TractionBoard; owner: React.ReactNode }) {
  const { live, people, signups, revenue, mrr, best, next, days } = board;
  const strip = people
    ? { title: "People per day", pick: (day: BoardDay) => day.people ?? 0, unit: "people", via: people.via }
    : revenue && board.currency
      ? {
          title: `Revenue per day (${board.currency})`,
          pick: (day: BoardDay) => Math.round((day.revenue ?? 0) / 100),
          unit: board.currency,
          via: revenue.via,
        }
      : null;
  return (
    <section id="traction" className="board @container scroll-mt-24 p-5 sm:p-7" aria-labelledby="traction-title">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 id="traction-title" className="font-display text-[1.9rem] leading-none font-extrabold sm:text-[2.4rem]">
            Traction
          </h2>
          <p className="mt-2 text-board-muted">Read straight from the source, never typed in. Last 30 days.</p>
        </div>
        {owner}
      </header>

      {live && (
        <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-board-ink/10 pt-6">
          <div>
            <Tiles value={shortCount(live.people)} className="text-[4rem] sm:text-[5rem]" />
            <span aria-hidden="true" className="now-pulse mt-2 block h-1 rounded-full bg-slop" />
          </div>
          <div>
            <p className="font-display text-[1.9rem] leading-none font-extrabold">On it now</p>
            <p className="mt-1.5">
              <span className="sr-only">{live.people} </span>
              {live.people === 1 ? "person" : "people"} in the last 30 minutes
            </p>
            <div className="mt-1.5">
              <ViaLine via={live.via} />
            </div>
          </div>
        </div>
      )}

      <dl className="mt-6 divide-y divide-board-ink/10 border-y border-board-ink/10">
        <div
          className="hidden grid-cols-[7.5rem_minmax(0,7rem)_minmax(0,1fr)_minmax(0,13rem)] gap-x-4 py-2.5 @[36rem]:grid"
          aria-hidden="true"
        >
          <span />
          <span className="caps text-[0.8rem] text-board-muted">Today</span>
          <span className="caps text-[0.8rem] text-board-muted">30 days</span>
          <span className="caps text-[0.8rem] text-board-muted">Where from</span>
        </div>
        {people && (
          <Row
            label="People"
            today={shortCount(people.today)}
            days30={people.days30 === null ? null : shortCount(people.days30)}
            via={people.via}
          />
        )}
        {signups && (
          <Row
            label="Signups"
            today={shortCount(signups.today)}
            days30={shortCount(signups.days30)}
            via={signups.via}
          />
        )}
        {revenue && (
          <Row label="Revenue" today={moneyText(revenue.today)} days30={moneyText(revenue.days30)} via={revenue.via} />
        )}
        {mrr && (
          <Row
            label="MRR"
            today={moneyText(mrr.amounts)}
            todayLabel="Per month"
            via={mrr.via}
            note={mrr.subscribers ? `· ${mrr.subscribers} subscriber${mrr.subscribers === 1 ? "" : "s"}` : undefined}
          />
        )}
      </dl>

      {strip && (
        <div className="mt-7">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h3 className="caps text-board-muted">{strip.title}</h3>
            {best && people && (
              <p className="text-sm text-board-muted">
                Best day: {formatDay(best.date)}, {best.people.toLocaleString("en")} people
              </p>
            )}
          </div>
          <Strip days={days} pick={strip.pick} unit={strip.unit} />
          <p className="mt-2 flex justify-between text-sm text-board-muted">
            <span>{formatDay(days[0].date)}</span>
            <span>Today</span>
          </p>
        </div>
      )}

      {next && people && (
        <p className="mt-6 border-t border-board-ink/10 pt-5 font-display text-[1.4rem] leading-tight font-extrabold">
          {next.remaining.toLocaleString("en")} more {next.remaining === 1 ? "person" : "people"}{" "}
          <span className="text-board-muted">this month to reach {next.target.toLocaleString("en")}.</span>
        </p>
      )}
    </section>
  );
}

/** The owner's "sync now", and the button that asks for fresh numbers when the page is open. */
function useFreshNumbers(slopId: string, traction: Traction) {
  const fetcher = useFetcher<{ synced: number }>();
  const action = `/api/slops/${slopId}/traction`;
  const latest = useRef(traction);
  latest.current = traction;
  const submit = fetcher.submit;

  useEffect(() => {
    if (latest.current.sources.length === 0) return;
    function check() {
      const stale = latest.current.sources.some(
        (source) => source.syncedAt === null || Date.now() - source.syncedAt > SYNC_EVERY_MS,
      );
      if (stale && document.visibilityState === "visible") void submit({}, { method: "post", action });
    }
    check();
    const timer = window.setInterval(check, SYNC_EVERY_MS);
    return () => window.clearInterval(timer);
  }, [action, submit]);

  return { fetcher, action };
}

export function TractionSection({
  slopId,
  traction,
  isOwner,
  editPath,
  className = "",
}: {
  slopId: string;
  traction: Traction;
  isOwner: boolean;
  editPath: string;
  /** Spacing from what comes before; nothing renders (and takes no space) for visitors without numbers. */
  className?: string;
}) {
  const { fetcher, action } = useFreshNumbers(slopId, traction);
  const hydrated = useHydrated();
  const board = tractionBoard(traction, new Date().toISOString().slice(0, 10), Date.now());
  const problems = isOwner ? traction.sources.filter((source) => source.status === "error") : [];
  const syncing = fetcher.state !== "idle";

  if (!board) {
    if (!isOwner) return null;
    return (
      <section
        id="traction"
        className={`scroll-mt-24 rounded-2xl bg-sunk p-5 sm:p-6 ${className}`}
        aria-labelledby="traction-title"
      >
        <h2 id="traction-title" className="font-display text-[1.75rem] leading-none font-extrabold">
          {traction.sources.length > 0 ? "Traction is on its way" : "Show real traction here"}
        </h2>
        <p className="mt-2 max-w-[56ch]">
          {traction.sources.length > 0
            ? "Your sources are connected. The board shows up as soon as the first numbers land."
            : "Connect Google Analytics, PostHog, Stripe or a Solana wallet and this page grows a board: who's on it now, people and signups per day, revenue. Read from the source, so nobody has to take your word for it."}
        </p>
        <ProblemList problems={problems} />
        <Link to={`${editPath}#traction`} className="btn btn-ink mt-4">
          {traction.sources.length > 0 ? "See your sources" : "Connect a source"}
        </Link>
      </section>
    );
  }

  return (
    <div className={`grid gap-3 ${className}`}>
      <Board
        board={board}
        owner={
          isOwner ? (
            <div className="flex flex-wrap items-center gap-2">
              <fetcher.Form method="post" action={action}>
                <input type="hidden" name="force" value="1" />
                <button
                  type="submit"
                  className="btn btn-sm bg-tile text-board-ink hover:bg-tile-top"
                  disabled={!hydrated || syncing}
                >
                  <Icon name="sync" className={`size-4 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing…" : "Sync now"}
                </button>
              </fetcher.Form>
              <Link to={`${editPath}#traction`} className="btn btn-sm bg-tile text-board-ink hover:bg-tile-top">
                Sources
              </Link>
            </div>
          ) : null
        }
      />
      <ProblemList problems={problems} />
    </div>
  );
}

function ProblemList({ problems }: { problems: Traction["sources"] }) {
  if (problems.length === 0) return null;
  return (
    <ul className="mt-3 grid gap-2" aria-label="Sources that need you">
      {problems.map((source) => (
        <li key={source.id} className="rounded-xl bg-hot-tint px-4 py-3 text-[0.9375rem]">
          <span className="font-bold">{INTEGRATIONS[source.provider].label}:</span> {source.error}
        </li>
      ))}
    </ul>
  );
}

/** One line under the hero: who's on it right now, for the first screen. */
export function LiveTeaser({ traction }: { traction: Traction }) {
  const board = tractionBoard(traction, new Date().toISOString().slice(0, 10), Date.now());
  if (!board?.live) return null;
  return (
    <a href="#traction" className="inline-flex min-h-11 items-center gap-2 text-[0.9375rem] hover:underline">
      <span aria-hidden="true" className="now-pulse size-2 rounded-full bg-slop" />
      <span className="font-bold tabular-nums">{board.live.people.toLocaleString("en")} on it now</span>
      <span className="text-muted">via {INTEGRATIONS[board.live.via.providers[0]].label}</span>
    </a>
  );
}
