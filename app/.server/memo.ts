/**
 * Tiny per-isolate cache for public feed queries. Deno Deploy's free plan
 * meters KV reads, so the same homepage query should not run for every
 * visitor. Writes call `invalidate` so the writer sees their change at once;
 * other isolates catch up within the TTL.
 */

interface Entry {
  expires: number;
  value: Promise<unknown>;
}

const entries = new Map<string, Entry>();

export function memo<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = entries.get(key);
  if (hit && hit.expires > now) return hit.value as Promise<T>;
  const value = load();
  entries.set(key, { expires: now + ttlMs, value });
  // Never cache failures.
  value.catch(() => entries.delete(key));
  return value;
}

/** Drops every cached feed; called after anything that changes them. */
export function invalidateFeeds(): void {
  entries.clear();
}
