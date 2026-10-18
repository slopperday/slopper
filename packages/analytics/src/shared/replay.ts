/**
 * Session recordings on the wire. The SDK records a page with rrweb and
 * sends what it recorded every few seconds as one chunk: a JSON array of
 * rrweb events, gzipped when the browser can, posted to `ROUTES.recordings`
 * with what the server needs to file it in the query string. The server
 * stores a chunk as it came and never reads inside it; the player does.
 */

export const REPLAY_LIMITS = {
  /** Bytes one chunk may take on the wire, compressed or not. */
  chunkBytes: 2_000_000,
  /** Bytes one session's recording may take in all; later chunks are dropped. */
  sessionBytes: 50_000_000,
  /** Events the SDK holds before it sends them. */
  chunkEvents: 400,
  /** How often the SDK sends what it holds. */
  flushIntervalMs: 5_000,
  idLength: 200,
  /** Older chunks are refused, like events (`BATCH_LIMITS.maxAgeMs`). */
  maxAgeMs: 7 * 86_400_000,
} as const;

export type ReplayEncoding = "gzip" | "identity";

/** What the server files a chunk under. Times are the sender's clock, in ms since the epoch. */
export interface ReplayChunkMeta {
  sessionId: string;
  distinctId: string;
  /** The first and last event's timestamps. */
  startedAt: number;
  endedAt: number;
  /** rrweb events in the chunk. */
  events: number;
  encoding: ReplayEncoding;
  /** The sender's clock when it left, to correct a skewed clock. */
  sentAt: number;
}

/** A chunk's query string. */
export function replayChunkParams(meta: ReplayChunkMeta): URLSearchParams {
  return new URLSearchParams({
    s: meta.sessionId,
    d: meta.distinctId,
    from: String(meta.startedAt),
    to: String(meta.endedAt),
    n: String(meta.events),
    z: meta.encoding === "gzip" ? "1" : "0",
    t: String(meta.sentAt),
  });
}

function integer(value: string | null): number | null {
  if (value === null || !/^\d{1,16}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function id(value: string | null): string | null {
  return value && value.length <= REPLAY_LIMITS.idLength ? value : null;
}

/** A chunk's metadata from its query string, or null when anything is missing or out of range. */
export function parseReplayChunkParams(params: URLSearchParams): ReplayChunkMeta | null {
  const sessionId = id(params.get("s"));
  const distinctId = id(params.get("d"));
  const startedAt = integer(params.get("from"));
  const endedAt = integer(params.get("to"));
  const events = integer(params.get("n"));
  const sentAt = integer(params.get("t"));
  const z = params.get("z");
  if (!sessionId || !distinctId || startedAt === null || endedAt === null || events === null || sentAt === null) {
    return null;
  }
  if (endedAt < startedAt || events < 1 || (z !== "0" && z !== "1")) return null;
  return { sessionId, distinctId, startedAt, endedAt, events, encoding: z === "1" ? "gzip" : "identity", sentAt };
}
