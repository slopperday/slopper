import type { FunctionReturnType, GenericActionCtx, GenericDataModel } from "convex/server";
import type { ComponentApi } from "../component/_generated/component";
import {
  ANY_EVENT,
  bucketStart,
  DAY_MS,
  DayRollup,
  type EventDay,
  type GroupDay,
  planRollups,
  ROLLUP_SETTLE_MS,
  type RollupPlan,
  rollupFits,
  type TimeRange,
  type WebDay,
} from "../shared/insights";
import { Scanner } from "./scanner";

type ReadCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery">;
type RollCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation">;
type RollupPage<Row> = { page: Row[]; isDone: boolean; continueCursor: string };

/** Rollup rows per page. Web rows are the biggest, a few kilobytes a day at Slopper's size. */
const PAGE_SIZE = 500;

/** Reads rolled-up days for the insights engine (`runInsight`). */
export class RollupReader {
  constructor(
    private readonly ctx: ReadCtx,
    private readonly component: ComponentApi,
  ) {}

  /** Which whole days of `range` to read from rollups, and what's left to read raw. */
  async plan(range: TimeRange, usable: (day: number) => boolean): Promise<RollupPlan> {
    const rolled = await this.ctx.runQuery(this.component.rollups.days, range);
    return planRollups(range, new Set(rolled), usable);
  }

  /** Pages through rows for the span the days cover, keeping only those days' rows. */
  private async each<Row extends { day: number }>(
    days: readonly number[],
    read: (args: { from: number; to: number; cursor: string | null; numItems: number }) => Promise<RollupPage<Row>>,
    each: (row: Row) => void,
  ): Promise<void> {
    const first = days[0];
    const last = days.at(-1);
    if (first === undefined || last === undefined) return;
    const wanted = new Set(days);
    let cursor: string | null = null;
    for (;;) {
      const result: RollupPage<Row> = await read({ from: first, to: last + DAY_MS, cursor, numItems: PAGE_SIZE });
      // Rows of days changed since they were rolled up wait for the next roll-up; they're skipped.
      for (const row of result.page) if (wanted.has(row.day)) each(row);
      if (result.isDone) return;
      cursor = result.continueCursor;
    }
  }

  async web(days: readonly number[], each: (day: WebDay) => void): Promise<void> {
    await this.each(days, (args) => this.ctx.runQuery(this.component.rollups.web, args), each);
  }

  /** One event's days (`ANY_EVENT` for every event). */
  async events(name: string, days: readonly number[], each: (day: EventDay) => void): Promise<void> {
    await this.each(days, (args) => this.ctx.runQuery(this.component.rollups.events, { name, ...args }), each);
  }

  async groups(days: readonly number[], each: (day: GroupDay) => void): Promise<void> {
    await this.each(days, (args) => this.ctx.runQuery(this.component.rollups.groups, args), each);
  }
}

export type RollDayOutcome = FunctionReturnType<ComponentApi["rollups"]["write"]>;

/**
 * Rolls up one day that's over: reads its sessions and events raw, page by
 * page, and writes the day's rows in place of any it had. Safe to run again
 * for the same day. `changed` means the day changed while it was read, so
 * it's left for next time.
 */
export async function rollDay(ctx: RollCtx, component: ComponentApi, day: number): Promise<RollDayOutcome> {
  if (bucketStart(day, "day") !== day) throw new Error("A rollup's day starts at UTC midnight.");
  const startedAt = Date.now();
  const range = { from: day, to: day + DAY_MS };
  const rollup = new DayRollup(day);
  const scan = new Scanner(ctx, component);
  await scan.sessions(range, (session) => rollup.addSession(session));
  await scan.events(ANY_EVENT, range, (event) => rollup.addEvent(event));
  const rows = rollup.result();
  return await ctx.runMutation(component.rollups.write, {
    day,
    startedAt,
    rows: scan.truncated || !rollupFits(rows) ? null : rows,
  });
}

export interface RollUpOptions {
  /** How many days back to make sure are rolled up; 8 unless set, for batches up to a week late. */
  lookbackDays?: number;
  /** Most days to roll up in this call; 10 unless set. */
  limit?: number;
}

export interface RollUpResult {
  rolled: number[];
  /** Too busy to fit in rollup rows; read raw. */
  oversized: number[];
  /** Changed while they were read; tried again next time. */
  changed: number[];
  /** More days are waiting: call again (from a scheduled function) to keep going. */
  more: boolean;
}

/** Days rolled up per call by default: each reads one day of raw rows. */
const ROLL_UP_LIMIT = 10;
/** Late batches are accepted for a week (`BATCH_LIMITS.maxAgeMs`), so the day after that is settled too. */
const LOOKBACK_DAYS = 8;

/**
 * Rolls up the days that need it: every settled day in the last
 * `lookbackDays` without a current rollup (yesterday, on a daily cron), and
 * any older day that changed since its roll-up. With a long `lookbackDays`
 * it backfills, `limit` days per call.
 */
export async function rollUp(
  ctx: RollCtx,
  component: ComponentApi,
  options: RollUpOptions = {},
  now: number = Date.now(),
): Promise<RollUpResult> {
  const lookbackDays = Math.max(1, Math.floor(options.lookbackDays ?? LOOKBACK_DAYS));
  const limit = Math.max(1, Math.floor(options.limit ?? ROLL_UP_LIMIT));
  const to = bucketStart(now - ROLLUP_SETTLE_MS, "day");
  const days = await ctx.runQuery(component.rollups.pending, { from: to - lookbackDays * DAY_MS, to, limit });
  const result: RollUpResult = { rolled: [], oversized: [], changed: [], more: false };
  for (const day of days) result[await rollDay(ctx, component, day)].push(day);
  // Days that changed again would come straight back: only go on if this call got somewhere.
  result.more = days.length === limit && result.changed.length < days.length;
  return result;
}
