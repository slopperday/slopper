import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import type { Kv, KvKey, KvListOptions, KvListSelector } from "@deno/kv";
import { monotonicFactory } from "ulid";

export type { Kv, KvKey };

interface DenoGlobal {
  openKv(path?: string): Promise<Kv>;
}

let kvPromise: Promise<Kv> | null = null;

/**
 * The shared KV handle. On Deno Deploy this is the database attached to the
 * app (`Deno.openKv()`); on Node (dev, tests, CI) it is `@deno/kv` backed by
 * a SQLite file under `.data/`, or memory when `KV_PATH=:memory:`.
 */
export function getKv(): Promise<Kv> {
  kvPromise ??= openKv();
  return kvPromise;
}

async function openKv(): Promise<Kv> {
  const deno = (globalThis as { Deno?: DenoGlobal }).Deno;
  if (deno) return await deno.openKv();

  const path = process.env.KV_PATH ?? ".data/slopper.kv";
  // A computed specifier keeps Deno from resolving this Node-only package.
  const specifier = "@deno/kv";
  const { openKv: openNodeKv } = (await import(/* @vite-ignore */ specifier)) as typeof import("@deno/kv");
  if (path === ":memory:") return await openNodeKv();
  await mkdir(dirname(path), { recursive: true });
  return await openNodeKv(path);
}

const nextUlid = monotonicFactory();

/** Time-sortable id; newest sorts last. */
export function newId(): string {
  return nextUlid();
}

/** Deno KV caps `getMany` at 10 keys, so larger lookups are chunked. */
export async function getManyValues<T>(kv: Kv, keys: readonly KvKey[]): Promise<(T | null)[]> {
  const values: (T | null)[] = [];
  for (let start = 0; start < keys.length; start += 10) {
    const entries = await kv.getMany<T[]>(keys.slice(start, start + 10));
    for (const entry of entries) values.push(entry.value);
  }
  return values;
}

export function present<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

export class ConflictError extends Error {
  constructor(message = "The record changed while it was being saved.") {
    super(message);
    this.name = "ConflictError";
  }
}

/**
 * Runs an optimistic read-modify-write until it commits. `attempt` returns
 * `null` to signal a lost race (failed `check`), and is retried.
 */
export async function withRetry<T>(attempt: () => Promise<T | null>, tries = 8): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const result = await attempt();
    if (result !== null) return result;
  }
  throw new ConflictError();
}

/** Lists the values under a selector. */
export async function listValues<T>(kv: Kv, selector: KvListSelector, options: KvListOptions = {}): Promise<T[]> {
  const values: T[] = [];
  for await (const entry of kv.list<T>(selector, options)) values.push(entry.value);
  return values;
}
