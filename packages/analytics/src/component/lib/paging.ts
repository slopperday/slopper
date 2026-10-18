import { v } from "convex/values";

/**
 * Paging for the component's queries. Components can't call `paginate()`
 * (it's only for apps), so pages run along an index by key: every index
 * ends in `_creationTime`, which breaks ties between rows with the same
 * key, so a cursor is the last row's key and creation time.
 */

export const pageArgs = { cursor: v.union(v.string(), v.null()), numItems: v.number() };

export interface PageCursor {
  key: number;
  created: number;
}

export interface Page<Row> {
  page: Row[];
  isDone: boolean;
  /** Where the next page starts; pass it back as `cursor`. */
  continueCursor: string;
}

/** Rows read per page at most, whatever is asked. */
const MAX_PAGE = 4_000;

export function parseCursor(cursor: string | null): PageCursor | null {
  if (!cursor) return null;
  const [key, created] = cursor.split(":").map(Number);
  return Number.isFinite(key) && Number.isFinite(created) ? { key: key ?? 0, created: created ?? 0 } : null;
}

function encode(cursor: PageCursor): string {
  return `${cursor.key}:${cursor.created}`;
}

interface Takes<Row> {
  take(count: number): Promise<Row[]>;
}

/**
 * One page: first the rest of the rows that share the cursor's key, then
 * the rows past it. The queries come from the caller, already ordered the
 * way the page runs (ascending or descending).
 */
export async function pageByKey<Row extends { _creationTime: number }>(options: {
  cursor: string | null;
  numItems: number;
  /** The index key a row is at. */
  key: (row: Row) => number;
  /** Rows with the cursor's key, past its creation time in the page's order. */
  sameKey: (cursor: PageCursor) => Takes<Row>;
  /** Rows past the cursor's key in the page's order, or from the start when there's no cursor. */
  rest: (cursor: PageCursor | null) => Takes<Row>;
}): Promise<Page<Row>> {
  const size = Math.max(1, Math.min(Math.floor(options.numItems), MAX_PAGE));
  const cursor = parseCursor(options.cursor);
  const page = cursor ? await options.sameKey(cursor).take(size) : [];
  if (page.length < size) page.push(...(await options.rest(cursor).take(size - page.length)));
  const last = page.at(-1);
  const next = last ? { key: options.key(last), created: last._creationTime } : cursor;
  return { page, isDone: page.length < size, continueCursor: next ? encode(next) : "" };
}
