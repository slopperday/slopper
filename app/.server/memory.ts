/**
 * A value read from Convex and kept in this server's memory, for what every
 * page needs and admins rarely change (flags, surveys). Within half a minute
 * of the last read it's used as it is; within five minutes it's used while
 * it's read again in the background; after that a page waits for a fresh
 * read. So only a server's first page, or its first after a quiet spell,
 * waits at all.
 */

const FRESH_MS = 30_000;
const STALE_MS = 300_000;

interface Read<Value> {
  at: number;
  value: Promise<Value>;
}

export interface Remembered<Value> {
  get(now?: number): Promise<Value>;
  /** Forgets it, for an admin who just changed it here: even a read already under way isn't kept. */
  forget(): void;
}

export function remembered<Value>(read: () => Promise<Value>): Remembered<Value> {
  let cache: Read<Value> | null = null;
  let refreshing: Read<Value> | null = null;
  let generation = 0;

  function start(now: number): Read<Value> {
    const started = generation;
    const next: Read<Value> = { at: now, value: read() };
    next.value.then(
      () => {
        if (refreshing === next) refreshing = null;
        if (started === generation && (!cache || cache.at < next.at)) cache = next;
      },
      // A failed read isn't kept: the next page tries again.
      () => {
        if (refreshing === next) refreshing = null;
        if (cache === next) cache = null;
      },
    );
    return next;
  }

  return {
    async get(now = Date.now()) {
      const age = cache ? now - cache.at : Infinity;
      if (!cache || age > STALE_MS) cache = start(now);
      else if (age > FRESH_MS && !refreshing) refreshing = start(now);
      return await cache.value;
    },
    forget() {
      generation += 1;
      cache = null;
      refreshing = null;
    },
  };
}
