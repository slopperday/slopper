import { Replayer } from "@rrweb/replay";
import "@rrweb/replay/dist/style.css";
import type { eventWithTime } from "@rrweb/types";
import type { ReplayEncoding } from "../shared/replay";

/**
 * Plays session recordings back, for an app's own admin pages. It brings
 * rrweb's player and its styles, so import it lazily, where a recording is
 * about to be watched, never from a page everyone loads.
 */

export interface RecordingChunk {
  /** Where the chunk is stored (the component's `recordings.get` hands these out). */
  url: string;
  encoding: ReplayEncoding;
}

function isEvent(value: unknown): value is eventWithTime {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof value.type === "number" &&
    "timestamp" in value &&
    typeof value.timestamp === "number"
  );
}

async function chunkEvents(chunk: RecordingChunk, fetcher: typeof fetch): Promise<eventWithTime[]> {
  const response = await fetcher(chunk.url);
  if (!response.ok || !response.body) throw new Error(`A part of the recording didn't load (${response.status}).`);
  const body = chunk.encoding === "gzip" ? response.body.pipeThrough(new DecompressionStream("gzip")) : response.body;
  const parsed: unknown = JSON.parse(await new Response(body).text());
  if (!Array.isArray(parsed)) throw new Error("A part of the recording isn't a list of events.");
  return parsed.filter(isEvent);
}

/** A recording's events, from all its chunks, in order. */
export async function loadRecording(
  chunks: readonly RecordingChunk[],
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<eventWithTime[]> {
  const parts = await Promise.all(chunks.map((chunk) => chunkEvents(chunk, fetcher)));
  return parts.flat().sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * A player for `events` inside `root`. It starts paused at the beginning;
 * `play(offset)` and `pause(offset)` move it, and `getMetaData()` says how
 * long it is. The recorded page is drawn at the size it was recorded at:
 * scale `replayer.wrapper` to fit.
 */
export function createReplayer(root: HTMLElement, events: readonly eventWithTime[]): Replayer {
  return new Replayer([...events], {
    root,
    skipInactive: true,
    showWarning: false,
    mouseTail: false,
    // Recordings never carry scripts; nothing in one should run either way.
    UNSAFE_replayCanvas: false,
  });
}

export type { Replayer };
export type { eventWithTime as RecordedEvent };
